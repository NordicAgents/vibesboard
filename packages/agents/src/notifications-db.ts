import 'server-only'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  notifications,
  users,
  type Notification
} from '@vibesboard/adapter-postgres/schema'
import type {
  NotificationDocument,
  NotificationEvent
} from '@vibesboard/contracts'

type Db = PostgresJsDatabase<typeof schema>

// Note: the legacy NotificationDocument carries agentName; the PG table does
// not store it (it is denormalized at the agent). The list API never used
// agentName on the client list — map it to '' to preserve the wire shape.
export const rowToNotification = (r: Notification): NotificationDocument => ({
  id: r.id,
  tenantId: r.tenantId,
  agentId: r.agentId,
  agentName: '',
  conversationId: r.conversationId ?? '',
  event: r.event,
  summary: r.summary ?? null,
  read: r.read,
  createdAt: r.createdAt.toISOString()
})

export async function createInAppNotification(
  params: {
    tenantId: string
    agentId: string
    conversationId: string | null
    event: NotificationEvent
    summary: string | null
  },
  db: Db = getMigrateDb()
): Promise<NotificationDocument> {
  const [row] = await db
    .insert(notifications)
    .values({
      id: uuidv7(),
      tenantId: params.tenantId,
      agentId: params.agentId,
      conversationId: params.conversationId,
      event: params.event,
      summary: params.summary,
      read: false
    })
    .returning()
  return rowToNotification(row)
}

export async function listNotifications(
  tenantId: string,
  opts: { limit: number; unreadOnly: boolean },
  db: Db = getMigrateDb()
): Promise<NotificationDocument[]> {
  const where = opts.unreadOnly
    ? and(
        eq(notifications.tenantId, tenantId),
        eq(notifications.read, false)
      )
    : eq(notifications.tenantId, tenantId)
  const rows = await db
    .select()
    .from(notifications)
    .where(where)
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit)
  return rows.map(rowToNotification)
}

export async function countUnreadNotifications(
  tenantId: string,
  db: Db = getMigrateDb()
): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.tenantId, tenantId), eq(notifications.read, false))
    )
  return rows.length
}

export async function markNotificationsRead(
  tenantId: string,
  ids: string[],
  db: Db = getMigrateDb()
): Promise<void> {
  if (ids.length === 0) return
  await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(eq(notifications.tenantId, tenantId), inArray(notifications.id, ids))
    )
}

export async function getUserEmail(
  userId: string,
  db: Db = getMigrateDb()
): Promise<string | null> {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return row?.email ?? null
}
