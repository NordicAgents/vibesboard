import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema'
import {
  resolveUserIdByGoogleSub,
  revokeUserSessions,
  setUserDisabled,
} from '../risc-effects.ts'

async function seedUser(adminDb: any, opts?: { sub?: string; providerId?: string }) {
  const userId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: `u${userId}@a.com`, name: 'U' })
  if (opts?.sub) {
    await adminDb.insert(accounts).values({
      id: randomUUID(),
      userId,
      providerId: opts.providerId ?? 'google',
      accountId: opts.sub,
    })
  }
  return userId
}

describe('risc-effects', () => {
  test('resolveUserIdByGoogleSub finds the user by google account_id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb, { sub: 'google-sub-123' })
      assert.equal(await resolveUserIdByGoogleSub('google-sub-123', adminDb), userId)
      assert.equal(await resolveUserIdByGoogleSub('nope', adminDb), null)
    })
  })

  test('resolveUserIdByGoogleSub also matches legacy google.com provider', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb, { sub: 'legacy-sub', providerId: 'google.com' })
      assert.equal(await resolveUserIdByGoogleSub('legacy-sub', adminDb), userId)
    })
  })

  test('revokeUserSessions deletes only the target user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedUser(adminDb)
      const b = await seedUser(adminDb)
      await adminDb.insert(sessions).values([
        { id: randomUUID(), userId: a, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
        { id: randomUUID(), userId: a, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
        { id: randomUUID(), userId: b, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) },
      ])
      await revokeUserSessions(a, adminDb)
      const aLeft = await adminDb.select().from(sessions).where(eq(sessions.userId, a))
      const bLeft = await adminDb.select().from(sessions).where(eq(sessions.userId, b))
      assert.equal(aLeft.length, 0)
      assert.equal(bLeft.length, 1)
    })
  })

  test('setUserDisabled toggles the flag', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seedUser(adminDb)
      await setUserDisabled(userId, true, adminDb)
      let [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      assert.equal(u.disabled, true)
      await setUserDisabled(userId, false, adminDb)
      ;[u] = await adminDb.select().from(users).where(eq(users.id, userId))
      assert.equal(u.disabled, false)
    })
  })
})
