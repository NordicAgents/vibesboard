import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils';
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema';
import {
  resolveUserIdByGoogleSub,
  revokeUserSessions,
  setUserDisabled,
} from '../risc-effects.ts';

async function seedUser(adminDb: any, opts?: { sub?: string; providerId?: string }) {
  const userId = randomUUID();
  await adminDb.insert(users).values({ id: userId, email: `u${userId}@a.com`, name: 'U' });
  if (opts?.sub) {
    await adminDb.insert(accounts).values({
      id: randomUUID(),
      userId,
      providerId: opts.providerId ?? 'google',
      accountId: opts.sub,
    });
  }
  return userId;
}

describe('risc-effects', () => {
  it('resolveUserIdByGoogleSub finds the user by google account_id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb, { sub: 'google-sub-123' });
      expect(await resolveUserIdByGoogleSub('google-sub-123', adminDb)).toBe(userId);
      expect(await resolveUserIdByGoogleSub('nope', adminDb)).toBe(null);
    });
  });

  it('resolveUserIdByGoogleSub also matches legacy google.com provider', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb, { sub: 'legacy-sub', providerId: 'google.com' });
      expect(await resolveUserIdByGoogleSub('legacy-sub', adminDb)).toBe(userId);
    });
  });

  it('revokeUserSessions deletes only the target user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedUser(adminDb);
      const b = await seedUser(adminDb);
      await adminDb.insert(sessions).values([
        { id: randomUUID(), userId: a, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
        { id: randomUUID(), userId: a, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
        { id: randomUUID(), userId: b, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
      ]);
      await revokeUserSessions(a, adminDb);
      const aLeft = await adminDb.select().from(sessions).where(eq(sessions.userId, a));
      const bLeft = await adminDb.select().from(sessions).where(eq(sessions.userId, b));
      expect(aLeft.length).toBe(0);
      expect(bLeft.length).toBe(1);
    });
  });

  it('setUserDisabled toggles the flag', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb);
      await setUserDisabled(userId, true, adminDb);
      let [u] = await adminDb.select().from(users).where(eq(users.id, userId));
      expect(u.disabled).toBe(true);
      await setUserDisabled(userId, false, adminDb);
      [u] = await adminDb.select().from(users).where(eq(users.id, userId));
      expect(u.disabled).toBe(false);
    });
  });
});
