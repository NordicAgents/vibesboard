import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  agents,
  calendarConnections,
} from '@vibesboard/adapter-postgres/schema'
import {
  upsertBooking,
  findActiveBookingByAttendee,
  setBookingStatus,
  listBookingsForDay,
} from '../bookings.ts'

async function seed(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  const a = randomUUID()
  const c = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false,
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'A',
    slug: 'a',
  })
  await adminDb.insert(calendarConnections).values({
    id: c,
    tenantId: t,
    provider: 'google_calendar',
    name: 'w',
    calendarId: 'primary',
    accessTokenEncrypted: 'e',
    refreshTokenEncrypted: 'r',
    scopes: [],
    connectedBy: u,
  })
  return { tenantId: t, agentId: a, connId: c }
}

describe('booking persistence', () => {
  test('upsertBooking is idempotent on (agent,start,email) for active bookings', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const base = {
        tenantId,
        agentId,
        calendarConnectionId: connId,
        provider: 'google_calendar' as const,
        externalEventId: 'evt1',
        title: 'Call',
        startTime: '2026-05-25T10:00:00.000Z',
        endTime: '2026-05-25T10:30:00.000Z',
        timezone: 'UTC',
        attendeeName: 'Jane',
        attendeeEmail: 'jane@x.com',
      }
      const first = await upsertBooking(base, adminDb)
      const second = await upsertBooking(
        { ...base, externalEventId: 'evt2' },
        adminDb,
      )
      assert.equal(first.id, second.id) // same booking returned, no duplicate
      assert.equal(second.externalEventId, 'evt1') // original kept (DO NOTHING)
    })
  })

  test('findActiveBookingByAttendee + setBookingStatus cancels', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      await upsertBooking(
        {
          tenantId,
          agentId,
          calendarConnectionId: connId,
          provider: 'google_calendar',
          externalEventId: 'evt1',
          title: 'Call',
          startTime: '2026-05-25T10:00:00.000Z',
          endTime: '2026-05-25T10:30:00.000Z',
          timezone: 'UTC',
          attendeeName: 'Jane',
          attendeeEmail: 'jane@x.com',
        },
        adminDb,
      )
      const found = await findActiveBookingByAttendee(
        tenantId,
        agentId,
        'jane@x.com',
        '2026-05-25T10:00:00.000Z',
        adminDb,
      )
      assert.ok(found)
      await setBookingStatus(
        tenantId,
        found!.id,
        { status: 'cancelled', cancelledAt: new Date().toISOString() },
        adminDb,
      )
      const day = await listBookingsForDay(
        tenantId,
        agentId,
        '2026-05-25',
        null,
        adminDb,
      )
      assert.equal(day.length, 0) // cancelled excluded from active list
    })
  })
})
