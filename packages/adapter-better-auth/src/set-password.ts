#!/usr/bin/env node
/**
 * Set a user's email/password credential directly, bypassing the reset-email
 * flow.
 *
 * This exists for two situations a self-hosted deployment actually hits:
 * recovering an account when RESEND_API_KEY is not configured (so reset mail
 * never sends), and giving a password to an account that was created through
 * Google sign-in only.
 *
 * Usage:
 *   bun run db:set-password you@example.com 'a-strong-password'
 *   PASSWORD='a-strong-password' bun run db:set-password you@example.com
 *
 * Prefer the environment variable — an argument is visible in your shell
 * history and to anything reading the process table.
 *
 * The hash is produced by Better Auth's own `hashPassword`, so the credential
 * is byte-identical to one created by signing up through the app. Connects
 * with DATABASE_MIGRATE_URL for the same reason the auth layer does: identity
 * rows are written before any tenant context exists.
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { and, eq } from 'drizzle-orm'
import { hashPassword } from 'better-auth/crypto'
import { uuidv7 } from 'uuidv7'
import * as schema from '@vibesboard/adapter-postgres/schema'

const CREDENTIAL_PROVIDER = 'credential'
const MIN_PASSWORD_LENGTH = 8

function usage(message: string): never {
  console.error(`[set-password] ${message}`)
  console.error("Usage: bun run db:set-password <email> '<password>'")
  console.error('   or: PASSWORD=<password> bun run db:set-password <email>')
  process.exit(2)
}

async function main() {
  const [emailArg, passwordArg] = process.argv.slice(2)
  const email = emailArg?.trim().toLowerCase()
  const password = process.env.PASSWORD ?? passwordArg

  if (!email) usage('No email given.')
  if (!password) usage('No password given.')
  if (password.length < MIN_PASSWORD_LENGTH) {
    usage(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  }

  const url = process.env.DATABASE_MIGRATE_URL
  if (!url) {
    console.error(
      '[set-password] DATABASE_MIGRATE_URL is not set. See .env.example — this ' +
        'script needs the migrate role, not the app role.'
    )
    process.exit(1)
  }

  const client = postgres(url, { max: 1, prepare: false })
  const db = drizzle(client, { schema })

  try {
    const [user] = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1)

    if (!user) {
      console.error(`[set-password] No user with email ${email}.`)
      process.exitCode = 1
      return
    }

    const hash = await hashPassword(password)

    const [existing] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.userId, user.id),
          eq(schema.accounts.providerId, CREDENTIAL_PROVIDER)
        )
      )
      .limit(1)

    if (existing) {
      await db
        .update(schema.accounts)
        .set({ password: hash, updatedAt: new Date() })
        .where(eq(schema.accounts.id, existing.id))
    } else {
      await db.insert(schema.accounts).values({
        id: uuidv7(),
        userId: user.id,
        providerId: CREDENTIAL_PROVIDER,
        accountId: user.id,
        password: hash
      })
    }

    // A password set out of band is only useful if the account can sign in,
    // and email/password sign-in requires a verified address.
    await db
      .update(schema.users)
      .set({ emailVerified: true, updatedAt: new Date() })
      .where(eq(schema.users.id, user.id))

    console.log(
      `[set-password] Password ${existing ? 'updated' : 'created'} for ${user.email}.`
    )
  } finally {
    await client.end({ timeout: 1 })
  }
}

main().catch(err => {
  console.error('[set-password] Failed:', err)
  process.exit(1)
})
