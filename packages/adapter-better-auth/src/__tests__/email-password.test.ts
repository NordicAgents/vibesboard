import { describe, it, expect } from 'vitest';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils';
import * as schema from '@vibesboard/adapter-postgres/schema';

function buildAuth(db: any) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema,
      usePlural: true,
    }),
    baseURL: 'http://localhost:3000',
    secret: 'test-secret-32-chars-long-aaaaaaaaaa',
    // Our schema uses uuid columns. Pass a function via advanced.database.generateId
    // so that get-id-field picks it up and generates valid UUIDs instead of nanoids.
    advanced: { database: { generateId: () => uuidv7() } },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false, // simplify test
    },
    databaseHooks: {
      user: {
        create: {
          after: async (_user: any) => {
            // Hook body intentionally inert here; tenant-creation behaviour is
            // covered in tenant-creation.test.ts.
          },
        },
      },
    },
  });
}

describe('Better Auth email/password sign-up + sign-in', () => {
  it('sign-up creates user', async () => {
    await withTestDb(async ({ adminDb }) => {
      const auth = buildAuth(adminDb);
      const result = await auth.api.signUpEmail({
        body: {
          email: 'alice@acme.com',
          password: 'correct-horse-battery-staple',
          name: 'Alice',
        },
      });

      expect(result.user).toBeTruthy();
      expect(result.user.email).toBe('alice@acme.com');

      const rows = await adminDb
        .select()
        .from(schema.users)
        .where(eq(schema.users.email, 'alice@acme.com'));
      expect(rows.length).toBe(1);
    });
  });

  it('sign-in with correct password returns a session', async () => {
    await withTestDb(async ({ adminDb }) => {
      const auth = buildAuth(adminDb);
      await auth.api.signUpEmail({
        body: { email: 'alice@acme.com', password: 'pw-1234567890', name: 'Alice' },
      });

      const result = await auth.api.signInEmail({
        body: { email: 'alice@acme.com', password: 'pw-1234567890' },
      });
      expect(result.user).toBeTruthy();
      expect(result.user.email).toBe('alice@acme.com');
    });
  });

  it('sign-in with wrong password is rejected', async () => {
    await withTestDb(async ({ adminDb }) => {
      const auth = buildAuth(adminDb);
      await auth.api.signUpEmail({
        body: { email: 'alice@acme.com', password: 'pw-1234567890', name: 'Alice' },
      });

      await expect(
        auth.api.signInEmail({
          body: { email: 'alice@acme.com', password: 'wrong-password' },
        }),
      ).rejects.toThrow();
    });
  });
});
