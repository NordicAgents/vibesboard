#!/usr/bin/env node
import { and, eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
// Better Auth's own scrypt hasher — using it guarantees the stored hash matches
// what the email/password sign-in flow expects. This script lives in the auth
// adapter (not adapter-postgres) precisely because it needs this dependency;
// the data layer stays auth-agnostic.
import { hashPassword, verifyPassword } from 'better-auth/crypto'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import * as schema from '@vibesboard/adapter-postgres/schema'

// Set (or reset) the email+password credential for an existing user so they can
// sign in locally. The seed only creates users rows, not credentials, so the
// seeded accounts can't log in until this runs.
//
// Usage:
//   bun run db:set-password you@example.com 'your-password'
//
// Also flips email_verified=true, because the app config sets
// requireEmailVerification: true — without it, a valid password still can't
// sign in. (Local-dev convenience; do not point this at a real database.)

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const email = args[0]?.trim().toLowerCase()
  const password = args[1]

  if (!email || !password) {
    console.error("[set-password] Usage: bun run db:set-password <email> '<password>'")
    process.exit(1)
  }
  if (password.length < 8) {
    console.error('[set-password] Password must be at least 8 characters.')
    process.exit(1)
  }

  // getMigrateDb() reads DATABASE_MIGRATE_URL (BYPASSRLS role that owns
  // users/accounts) and throws if unset. Run via plain `node`, no .env is
  // loaded, so seed the same local fallback the other db scripts hardcode
  // (seed.ts, make-admin.ts) before touching the canonical client.
  process.env.DATABASE_MIGRATE_URL ??=
    'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'
  const db = getMigrateDb()

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1)

  if (!user) {
    console.error(
      `[set-password] No user found with email "${email}". ` +
        'Create the user first (sign up, or seed), then re-run.',
    )
    process.exit(1)
  }

  const hash = await hashPassword(password)

  // Upsert the credential account (provider_id='credential', account_id=email
  // — matching this project's existing convention).
  const [existing] = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.userId, user.id),
        eq(schema.accounts.providerId, 'credential'),
      ),
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
      providerId: 'credential',
      accountId: email,
      password: hash,
    })
  }

  // requireEmailVerification is on; mark verified so sign-in isn't blocked.
  await db
    .update(schema.users)
    .set({ emailVerified: true })
    .where(eq(schema.users.id, user.id))

  // Verify the stored hash actually authenticates this password — this is the
  // exact check the sign-in flow runs, so a pass here means login will work.
  const [check] = await db
    .select({ password: schema.accounts.password })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.userId, user.id),
        eq(schema.accounts.providerId, 'credential'),
      ),
    )
    .limit(1)

  const ok = check?.password ? await verifyPassword({ hash: check.password, password }) : false
  if (!ok) {
    throw new Error('Stored credential failed self-verification — password NOT set.')
  }

  console.log(
    `[set-password] Password set for ${user.email} (${existing ? 'updated' : 'created'} credential, email_verified=true, self-check OK).`,
  )

  // getMigrateDb() returns a shared pool with no exposed close; exit explicitly
  // so the open connection doesn't keep this one-shot CLI alive.
  process.exit(0)
}

main().catch((err) => {
  console.error('[set-password] Failed:', err)
  process.exit(1)
})
