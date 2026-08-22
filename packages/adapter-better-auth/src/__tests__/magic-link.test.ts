import { describe, it, expect } from 'vitest';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils';
import * as schema from '@vibesboard/adapter-postgres/schema';

function buildAuth(db: any, sink: { sent?: { email: string; url: string } } = {}) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    baseURL: 'http://localhost:3000',
    secret: 'test-secret-32-chars-long-aaaaaaaaaa',
    // Our schema uses uuid columns. Pass a function via advanced.database.generateId
    // so that get-id-field picks it up and generates valid UUIDs instead of nanoids.
    advanced: { database: { generateId: () => uuidv7() } },
    emailAndPassword: { enabled: false },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }: { email: string; url: string }) => {
          sink.sent = { email, url };
        },
      }),
    ],
  });
}

describe('Better Auth magic link', () => {
  it('signInMagicLink invokes sendMagicLink with a URL', async () => {
    await withTestDb(async ({ adminDb }) => {
      const sink: { sent?: { email: string; url: string } } = {};
      const auth = buildAuth(adminDb, sink);

      // signInMagicLink requires headers (enforced by better-call's requireHeaders check)
      await auth.api.signInMagicLink({
        body: { email: 'alice@acme.com' },
        headers: new Headers({ 'content-type': 'application/json' }),
      });

      expect(sink.sent).toBeTruthy();
      expect(sink.sent!.email).toBe('alice@acme.com');
      expect(sink.sent!.url).toMatch(/^http:\/\/localhost:3000\//);
    });
  });
});
