import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils';
import * as schema from '@vibesboard/adapter-postgres/schema';

// Regression test for the bug fixed in commit 5377ed4
// (fix(adapter-better-auth): use BYPASSRLS migrate role for identity ops).
//
// Before the fix, config.ts wired Better Auth through getDb() — the
// RLS-enforced app role. Sign-up therefore tried `INSERT INTO users` with no
// current_user_id GUC set, RLS evaluated false, and the insert failed with
// 42501. With getMigrateDb() (BYPASSRLS) the insert succeeds end-to-end.
//
// config.ts exports `auth` as a lazy-init Proxy that caches the betterAuth
// instance on first property access, and getMigrateDb() caches its postgres
// client; this file is intentionally single-test / single-import. We point the
// production module's lazy clients at the ephemeral test schema by appending
// search_path (forwarded as a Postgres startup param by postgres-js) plus
// idle_timeout so the cached pool releases the event loop.

function withSearchPath(url: string, schemaName: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}search_path=${encodeURIComponent(`${schemaName},public`)}&idle_timeout=1`;
}

describe('config.ts production wiring', () => {
  it('wires Better Auth through the BYPASSRLS migrate role (regression for PR #168)', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      const origAppUrl = process.env.DATABASE_URL;
      const origMigrateUrl = process.env.DATABASE_MIGRATE_URL;
      const origSecret = process.env.BETTER_AUTH_SECRET;
      const origResend = process.env.RESEND_API_KEY;

      const baseAppUrl =
        origAppUrl ?? 'postgres://vibesboard_app:vibesboard_app@localhost:5432/vibesboard_dev';
      const baseMigrateUrl =
        origMigrateUrl ??
        'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev';

      process.env.DATABASE_URL = withSearchPath(baseAppUrl, schemaName);
      process.env.DATABASE_MIGRATE_URL = withSearchPath(baseMigrateUrl, schemaName);
      process.env.BETTER_AUTH_SECRET ??= 'test-secret-32-chars-long-aaaaaaaaaa';
      // Force the console-log fallback in email.ts so we don't depend on Resend.
      delete process.env.RESEND_API_KEY;

      try {
        const { auth } = await import('../config.ts');

        // If config.ts wired Better Auth through getDb() (the RLS-enforced app
        // role, as it did before commit 5377ed4), this call would throw with
        // 42501. With getMigrateDb() the insert succeeds.
        await auth.api.signUpEmail({
          body: {
            email: 'wiring@regression.test',
            password: 'correct-horse-battery-staple',
            name: 'Wiring',
          },
        });

        const rows = await adminDb
          .select()
          .from(schema.users)
          .where(eq(schema.users.email, 'wiring@regression.test'));
        expect(rows.length).toBe(1);
      } finally {
        if (origAppUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = origAppUrl;
        if (origMigrateUrl === undefined) delete process.env.DATABASE_MIGRATE_URL;
        else process.env.DATABASE_MIGRATE_URL = origMigrateUrl;
        if (origSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
        else process.env.BETTER_AUTH_SECRET = origSecret;
        if (origResend !== undefined) process.env.RESEND_API_KEY = origResend;
      }
    });
  });
});
