#!/usr/bin/env node
/**
 * Promote (or demote) a user to platform super admin.
 *
 * `users.is_super_admin` is the only way into the admin panel, and nothing in
 * the product sets it — the first super admin on a fresh deployment has to be
 * granted out of band. This script is that path.
 *
 * Usage:
 *   bun run db:make-admin you@example.com
 *   bun run db:make-admin you@example.com --revoke
 *
 * Connects with DATABASE_MIGRATE_URL (the BYPASSRLS role) because `users` is
 * written before any tenant context exists — the same reason the auth layer
 * uses that role.
 */
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import * as schema from './schema/index.ts'

function usage(message: string): never {
  console.error(`[make-admin] ${message}`)
  console.error('Usage: bun run db:make-admin <email> [--revoke]')
  process.exit(2)
}

async function main() {
  const args = process.argv.slice(2)
  const revoke = args.includes('--revoke')
  const email = args
    .find(arg => !arg.startsWith('--'))
    ?.trim()
    .toLowerCase()

  if (!email) usage('No email given.')
  if (!email.includes('@'))
    usage(`"${email}" does not look like an email address.`)

  const url = process.env.DATABASE_MIGRATE_URL
  if (!url) {
    console.error(
      '[make-admin] DATABASE_MIGRATE_URL is not set. See .env.example — this ' +
        'script needs the migrate role, not the app role.'
    )
    process.exit(1)
  }

  const client = postgres(url, { max: 1, prepare: false })
  const db = drizzle(client, { schema })

  try {
    const [updated] = await db
      .update(schema.users)
      .set({ isSuperAdmin: !revoke, updatedAt: new Date() })
      .where(eq(schema.users.email, email))
      .returning({ id: schema.users.id, email: schema.users.email })

    if (!updated) {
      console.error(
        `[make-admin] No user with email ${email}. Sign up in the app first, ` +
          'then re-run this — the account has to exist before it can be promoted.'
      )
      process.exitCode = 1
      return
    }

    console.log(
      revoke
        ? `[make-admin] Revoked super admin from ${updated.email} (${updated.id}).`
        : `[make-admin] ${updated.email} (${updated.id}) is now a super admin.`
    )
  } finally {
    await client.end({ timeout: 1 })
  }
}

main().catch(err => {
  console.error('[make-admin] Failed:', err)
  process.exit(1)
})
