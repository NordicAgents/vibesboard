import { describe, it, expect } from 'vitest'
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
import { type NotificationEvent } from '@vibesboard/contracts'

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
  it('create → list → count → markRead', async () => {
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
      expect(n.read).toBe(false)
      expect(await countUnreadNotifications(tenantId, adminDb)).toBe(1)
      const all = await listNotifications(
        tenantId,
        { limit: 20, unreadOnly: false },
        adminDb
      )
      expect(all.length).toBe(1)
      expect(all[0].event).toBe('completed')
      await markNotificationsRead(tenantId, [n.id], adminDb)
      expect(await countUnreadNotifications(tenantId, adminDb)).toBe(0)
    })
  })

  it('listNotifications unreadOnly filters read rows', async () => {
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
      expect(unread.length).toBe(1)
      expect(unread[0].event).toBe('handoff')
    })
  })

  it('markNotificationsRead with empty ids is a no-op', async () => {
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
      expect(await countUnreadNotifications(tenantId, adminDb)).toBe(1)
    })
  })

  it('getUserEmail returns the user email', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { userId } = await seed(adminDb)
      const email = await getUserEmail(userId, adminDb)
      expect(email && email.endsWith('@a.com')).toBeTruthy()
    })
  })

  it('getUserEmail returns null for unknown user', async () => {
    await withTestDb(async ({ adminDb }) => {
      await seed(adminDb)
      const email = await getUserEmail(randomUUID(), adminDb)
      expect(email).toBe(null)
    })
  })

  it('listNotifications respects the limit and returns newest first', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      for (let i = 0; i < 3; i++) {
        await createInAppNotification(
          {
            tenantId,
            agentId,
            conversationId: null,
            event: `event-${i}` as NotificationEvent,
            summary: null
          },
          adminDb
        )
      }
      const limited = await listNotifications(
        tenantId,
        { limit: 2, unreadOnly: false },
        adminDb
      )
      expect(limited.length).toBe(2)
      // newest-first ordering: the last-created event comes first
      expect(limited[0].event).toBe('event-2')
    })
  })

  it('createInAppNotification maps null conversationId to "" and null summary to null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const n = await createInAppNotification(
        {
          tenantId,
          agentId,
          conversationId: null,
          event: 'completed',
          summary: null
        },
        adminDb
      )
      // rowToNotification: conversationId ?? '' and summary ?? null
      expect(n.conversationId).toBe('')
      expect(n.summary).toBe(null)
      expect(n.agentName).toBe('')
      expect(typeof n.createdAt).toBe('string')
    })
  })

  it('notifications + unread counts are isolated per tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seed(adminDb)
      await createInAppNotification(
        {
          tenantId: a.tenantId,
          agentId: a.agentId,
          conversationId: null,
          event: 'completed',
          summary: null
        },
        adminDb
      )
      expect(await countUnreadNotifications(b.tenantId, adminDb)).toBe(0)
      expect(
        await listNotifications(b.tenantId, { limit: 20, unreadOnly: false }, adminDb)
      ).toEqual([])
      // tenant B cannot mark tenant A's notification read
      const aList = await listNotifications(
        a.tenantId,
        { limit: 20, unreadOnly: false },
        adminDb
      )
      await markNotificationsRead(b.tenantId, [aList[0].id], adminDb)
      expect(await countUnreadNotifications(a.tenantId, adminDb)).toBe(1)
    })
  })
})
