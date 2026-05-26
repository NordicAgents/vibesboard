import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema'
import { handleRiscEvents, RISC_EVENTS } from '../risc.ts'

async function seed(adminDb: any, sub: string) {
  const userId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: `u${userId}@a.com`, name: 'U' })
  await adminDb.insert(accounts).values({ id: randomUUID(), userId, providerId: 'google', accountId: sub })
  await adminDb.insert(sessions).values({ id: randomUUID(), userId, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) })
  return userId
}
const tok = (event: string, sub: string) => ({
  iss: 'https://accounts.google.com', aud: 'x', iat: 0, jti: randomUUID(),
  events: { [event]: { subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub } } },
})

describe('handleRiscEvents (Better Auth)', () => {
  test('sessions-revoked deletes the user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-1')
      await handleRiscEvents(tok(RISC_EVENTS.SESSIONS_REVOKED, 'sub-1'), adminDb)
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      assert.equal(left.length, 0)
    })
  })

  test('account-disabled sets disabled + revokes sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-2')
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_DISABLED, 'sub-2'), adminDb)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      assert.equal(u.disabled, true)
      assert.equal(left.length, 0)
    })
  })

  test('account-enabled clears disabled', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-3')
      await adminDb.update(users).set({ disabled: true }).where(eq(users.id, userId))
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_ENABLED, 'sub-3'), adminDb)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      assert.equal(u.disabled, false)
    })
  })

  test('unknown sub is a no-op (does not throw)', async () => {
    await withTestDb(async ({ adminDb }) => {
      await handleRiscEvents(tok(RISC_EVENTS.SESSIONS_REVOKED, 'no-such-sub'), adminDb)
    })
  })

  test('verification event is a no-op', async () => {
    await withTestDb(async ({ adminDb }) => {
      await handleRiscEvents(tok(RISC_EVENTS.VERIFICATION, 'whatever'), adminDb)
    })
  })
})
