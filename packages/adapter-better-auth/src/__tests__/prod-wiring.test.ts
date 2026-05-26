import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import * as schema from '@vibesboard/adapter-postgres/schema'

// config.ts's lazy-init getMigrateDb() opens a postgres pool that this test
// has no handle on (it's cached at module scope). With no idle_timeout the
// subprocess wouldn't exit cleanly after the test passes. We append
// idle_timeout=1 to the URL below so the pool releases the event loop, and
// add a small unref()'d exit backstop here as belt-and-braces.
after(() => {
  setTimeout(() => process.exit(0), 1500).unref()
})

// Regression test for the bug fixed in commit 5377ed4
// (fix(adapter-better-auth): use BYPASSRLS migrate role for identity ops).
//
// Before the fix, packages/adapter-better-auth/src/config.ts wired Better
// Auth through getDb() — the RLS-enforced app role. Sign-up therefore tried
// `INSERT INTO users` with no current_user_id GUC set, RLS evaluated false,
// and the insert failed at runtime with:
//
//   42501: new row violates row-level security policy for table "users"
//
// The existing email-password / magic-link tests didn't catch this because
// each one constructs its own betterAuth({ database: drizzleAdapter(adminDb,
// ...) }) inside a local buildAuth(db) helper — they exercise the adapter,
// but not the production wiring in config.ts. This test imports the actual
// exported `auth` and proves that signUpEmail completes end-to-end against
// a real Postgres with RLS enabled.
//
// Caveats:
//   - config.ts exports `auth` as a lazy-init Proxy that caches the
//     betterAuth instance on first property access. getMigrateDb() also
//     caches its postgres client. So this file is intentionally single-test
//     and single-import — there is no clean way to reset those caches
//     without subprocess isolation, and one positive assertion is enough to
//     guard the wiring.
//   - We point the production module's lazy clients at the ephemeral test
//     schema by appending `?search_path=<schema>,public` to DATABASE_URL /
//     DATABASE_MIGRATE_URL before importing config.ts. postgres-js passes
//     unrecognized URL query params through as Postgres startup parameters,
//     so every connection in the pool starts with the test schema on its
//     search_path.

function withSearchPath(url: string, schemaName: string): string {
  const sep = url.includes('?') ? '&' : '?'
  // search_path is forwarded as a Postgres startup parameter (postgres-js
  // passes unknown URL query params straight to the connection's startup
  // packet). idle_timeout lets the cached migrate pool release the event
  // loop after the test completes.
  return `${url}${sep}search_path=${encodeURIComponent(
    `${schemaName},public`,
  )}&idle_timeout=1`
}

test('config.ts wires Better Auth through the BYPASSRLS migrate role (regression for PR #168)', async () => {
  await withTestDb(async ({ adminDb, schemaName }) => {
    const origAppUrl = process.env.DATABASE_URL
    const origMigrateUrl = process.env.DATABASE_MIGRATE_URL
    const origSecret = process.env.BETTER_AUTH_SECRET
    const origResend = process.env.RESEND_API_KEY

    const baseAppUrl =
      origAppUrl ?? 'postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev'
    const baseMigrateUrl =
      origMigrateUrl ??
      'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'

    process.env.DATABASE_URL = withSearchPath(baseAppUrl, schemaName)
    process.env.DATABASE_MIGRATE_URL = withSearchPath(baseMigrateUrl, schemaName)
    process.env.BETTER_AUTH_SECRET ??= 'test-secret-32-chars-long-aaaaaaaaaa'
    // Force the console-log fallback in email.ts so we don't depend on Resend.
    delete process.env.RESEND_API_KEY

    try {
      const { auth } = await import('../config.ts')

      // If config.ts had wired Better Auth through getDb() (the RLS-enforced
      // app role, as it did before commit 5377ed4), this call would throw
      // with `42501: new row violates row-level security policy for table
      // "users"`. With getMigrateDb() the insert succeeds.
      await auth.api.signUpEmail({
        body: {
          email: 'wiring@regression.test',
          password: 'correct-horse-battery-staple',
          name: 'Wiring',
        },
      })

      const rows = await adminDb
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'wiring@regression.test'))
      assert.equal(
        rows.length,
        1,
        'users row should have been inserted via the BYPASSRLS migrate role',
      )
    } finally {
      if (origAppUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = origAppUrl
      if (origMigrateUrl === undefined) delete process.env.DATABASE_MIGRATE_URL
      else process.env.DATABASE_MIGRATE_URL = origMigrateUrl
      if (origSecret === undefined) delete process.env.BETTER_AUTH_SECRET
      else process.env.BETTER_AUTH_SECRET = origSecret
      if (origResend !== undefined) process.env.RESEND_API_KEY = origResend
    }
  })
})
