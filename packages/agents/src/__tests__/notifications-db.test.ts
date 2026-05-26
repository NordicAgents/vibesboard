import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  createInAppNotification,
  listNotifications,
  countUnreadNotifications,
  markNotificationsRead,
  getUserEmail
} from '../notifications-db.ts'

async function seed(adminDb: any) {
  const u = randomUUID(),
    t = randomUUID(),
    a = randomUUID()
  await adminDb
    .insert(users)
    .values({ id: u, email: `o${u}@a.com`, name: 'Owner' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'Agent',
    slug: `ag-${a.slice(0, 8)}`
  })
  return { userId: u, tenantId: t, agentId: a }
}

describe('notifications (postgres)', () => {
  test('create → list → count → markRead', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const n = await createInAppNotification(
        {
          tenantId,
          agentId,
          conversationId: null,
          event: 'completed',
          summary: 'done'
        },
        adminDb
      )
      assert.equal(n.read, false)
      assert.equal(await countUnreadNotifications(tenantId, adminDb), 1)
      const all = await listNotifications(
        tenantId,
        { limit: 20, unreadOnly: false },
        adminDb
      )
      assert.equal(all.length, 1)
      assert.equal(all[0].event, 'completed')
      await markNotificationsRead(tenantId, [n.id], adminDb)
      assert.equal(await countUnreadNotifications(tenantId, adminDb), 0)
    })
  })

  test('listNotifications unreadOnly filters read rows', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const a = await createInAppNotification(
        {
          tenantId,
          agentId,
          conversationId: null,
          event: 'completed',
          summary: null
        },
        adminDb
      )
      await createInAppNotification(
        {
          tenantId,
          agentId,
          conversationId: null,
          event: 'handoff',
          summary: null
        },
        adminDb
      )
      await markNotificationsRead(tenantId, [a.id], adminDb)
      const unread = await listNotifications(
        tenantId,
        { limit: 20, unreadOnly: true },
        adminDb
      )
      assert.equal(unread.length, 1)
      assert.equal(unread[0].event, 'handoff')
    })
  })

  test('markNotificationsRead with empty ids is a no-op', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      await createInAppNotification(
        {
          tenantId,
          agentId,
          conversationId: null,
          event: 'completed',
          summary: null
        },
        adminDb
      )
      await markNotificationsRead(tenantId, [], adminDb)
      assert.equal(await countUnreadNotifications(tenantId, adminDb), 1)
    })
  })

  test('getUserEmail returns the user email', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { userId } = await seed(adminDb)
      const email = await getUserEmail(userId, adminDb)
      assert.ok(email && email.endsWith('@a.com'))
    })
  })

  test('getUserEmail returns null for unknown user', async () => {
    await withTestDb(async ({ adminDb }) => {
      await seed(adminDb)
      const email = await getUserEmail(randomUUID(), adminDb)
      assert.equal(email, null)
    })
  })
})
