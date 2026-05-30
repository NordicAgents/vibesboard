import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  agents,
  calendarConnections,
  tenants,
  users,
} from '@vibesboard/adapter-postgres/schema'

import {
  findActiveBookingByAttendee,
  listBookingsForDay,
  setBookingStatus,
  upsertBooking,
} from '../bookings.ts'

// Seed a tenant + owner + agent + calendar connection using the BYPASSRLS
// admin connection. Returns the ids the booking functions need.
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

const baseBooking = (over: Record<string, unknown> = {}) => ({
  provider: 'google_calendar' as const,
  externalEventId: 'evt1',
  title: 'Call',
  startTime: '2026-05-25T10:00:00.000Z',
  endTime: '2026-05-25T10:30:00.000Z',
  timezone: 'UTC',
  attendeeName: 'Jane',
  attendeeEmail: 'jane@x.com',
  ...over,
})

describe('booking persistence', () => {
  it('upsertBooking persists a confirmed booking and maps the row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const created = await upsertBooking(
        baseBooking({ tenantId, agentId, calendarConnectionId: connId }),
        adminDb,
      )
      expect(created.id).toBeTruthy()
      expect(created.tenantId).toBe(tenantId)
      expect(created.agentId).toBe(agentId)
      expect(created.status).toBe('confirmed')
      expect(created.title).toBe('Call')
      // ISO-string mapping from db.ts rowToBooking
      expect(created.startTime).toBe('2026-05-25T10:00:00.000Z')
      expect(created.endTime).toBe('2026-05-25T10:30:00.000Z')
      // optional fields default to '' / undefined via the mapper
      expect(created.conversationId).toBe('')
      expect(created.description).toBe(undefined)
      expect(created.meetLink).toBe(undefined)
    })
  })

  it('upsertBooking persists optional conversationId/description/meetLink', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const created = await upsertBooking(
        baseBooking({
          tenantId,
          agentId,
          calendarConnectionId: connId,
          description: 'Intro chat',
          meetLink: 'https://meet/abc',
        }),
        adminDb,
      )
      expect(created.description).toBe('Intro chat')
      expect(created.meetLink).toBe('https://meet/abc')
    })
  })

  it('upsertBooking is idempotent on (agent,start,email) for active bookings', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const base = baseBooking({ tenantId, agentId, calendarConnectionId: connId })
      const first = await upsertBooking(base, adminDb)
      const second = await upsertBooking({ ...base, externalEventId: 'evt2' }, adminDb)
      // same booking returned, no duplicate
      expect(first.id).toBe(second.id)
      // original kept (ON CONFLICT DO NOTHING), so externalEventId is the first one
      expect(second.externalEventId).toBe('evt1')
    })
  })

  it('upsertBooking only treats an active booking as a conflict; a different start time inserts a new row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const base = baseBooking({ tenantId, agentId, calendarConnectionId: connId })
      const first = await upsertBooking(base, adminDb)
      const other = await upsertBooking(
        {
          ...base,
          startTime: '2026-05-25T12:00:00.000Z',
          endTime: '2026-05-25T12:30:00.000Z',
        },
        adminDb,
      )
      expect(other.id).not.toBe(first.id)
      const day = await listBookingsForDay(tenantId, agentId, '2026-05-25', null, adminDb)
      expect(day.length).toBe(2)
    })
  })

  it('findActiveBookingByAttendee matches within the 1-minute tolerance', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const created = await upsertBooking(
        baseBooking({ tenantId, agentId, calendarConnectionId: connId }),
        adminDb,
      )
      // 30s later still matches (< 60s tolerance)
      const found = await findActiveBookingByAttendee(
        tenantId,
        agentId,
        'jane@x.com',
        '2026-05-25T10:00:30.000Z',
        adminDb,
      )
      expect(found?.id).toBe(created.id)
    })
  })

  it('findActiveBookingByAttendee returns null when outside the tolerance', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      await upsertBooking(baseBooking({ tenantId, agentId, calendarConnectionId: connId }), adminDb)
      // 5 minutes off -> no match
      const found = await findActiveBookingByAttendee(
        tenantId,
        agentId,
        'jane@x.com',
        '2026-05-25T10:05:00.000Z',
        adminDb,
      )
      expect(found).toBe(null)
    })
  })

  it('findActiveBookingByAttendee returns null for a different attendee', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      await upsertBooking(baseBooking({ tenantId, agentId, calendarConnectionId: connId }), adminDb)
      const found = await findActiveBookingByAttendee(
        tenantId,
        agentId,
        'someone-else@x.com',
        '2026-05-25T10:00:00.000Z',
        adminDb,
      )
      expect(found).toBe(null)
    })
  })

  it('setBookingStatus cancels and listBookingsForDay then excludes it', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const created = await upsertBooking(
        baseBooking({ tenantId, agentId, calendarConnectionId: connId }),
        adminDb,
      )
      await setBookingStatus(
        tenantId,
        created.id,
        { status: 'cancelled', cancelledAt: new Date().toISOString() },
        adminDb,
      )
      const day = await listBookingsForDay(tenantId, agentId, '2026-05-25', null, adminDb)
      expect(day.length).toBe(0) // cancelled excluded from active list
      // and a cancelled booking is no longer found as active
      const found = await findActiveBookingByAttendee(
        tenantId,
        agentId,
        'jane@x.com',
        '2026-05-25T10:00:00.000Z',
        adminDb,
      )
      expect(found).toBe(null)
    })
  })

  it('setBookingStatus can reschedule and update start/end times', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      const created = await upsertBooking(
        baseBooking({ tenantId, agentId, calendarConnectionId: connId }),
        adminDb,
      )
      await setBookingStatus(
        tenantId,
        created.id,
        {
          status: 'rescheduled',
          startTime: '2026-05-25T14:00:00.000Z',
          endTime: '2026-05-25T14:30:00.000Z',
        },
        adminDb,
      )
      const day = await listBookingsForDay(tenantId, agentId, '2026-05-25', null, adminDb)
      // 'rescheduled' is still an active status, so it remains listed
      expect(day.length).toBe(1)
      expect(day[0].status).toBe('rescheduled')
      expect(day[0].startTime).toBe('2026-05-25T14:00:00.000Z')
      expect(day[0].endTime).toBe('2026-05-25T14:30:00.000Z')
    })
  })

  it('listBookingsForDay only returns bookings whose start falls in the UTC day, ordered by start', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      // two on the target day (out of order), one the next day
      await upsertBooking(
        baseBooking({
          tenantId,
          agentId,
          calendarConnectionId: connId,
          startTime: '2026-05-25T15:00:00.000Z',
          endTime: '2026-05-25T15:30:00.000Z',
          attendeeEmail: 'late@x.com',
        }),
        adminDb,
      )
      await upsertBooking(
        baseBooking({
          tenantId,
          agentId,
          calendarConnectionId: connId,
          startTime: '2026-05-25T09:00:00.000Z',
          endTime: '2026-05-25T09:30:00.000Z',
          attendeeEmail: 'early@x.com',
        }),
        adminDb,
      )
      await upsertBooking(
        baseBooking({
          tenantId,
          agentId,
          calendarConnectionId: connId,
          startTime: '2026-05-26T09:00:00.000Z',
          endTime: '2026-05-26T09:30:00.000Z',
          attendeeEmail: 'nextday@x.com',
        }),
        adminDb,
      )

      const day = await listBookingsForDay(tenantId, agentId, '2026-05-25', null, adminDb)
      expect(day.map((b) => b.attendeeEmail)).toEqual(['early@x.com', 'late@x.com'])
    })
  })

  it('listBookingsForDay filters by attendee email case-insensitively', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, connId } = await seed(adminDb)
      await upsertBooking(
        baseBooking({
          tenantId,
          agentId,
          calendarConnectionId: connId,
          attendeeEmail: 'jane@x.com',
        }),
        adminDb,
      )
      await upsertBooking(
        baseBooking({
          tenantId,
          agentId,
          calendarConnectionId: connId,
          startTime: '2026-05-25T11:00:00.000Z',
          endTime: '2026-05-25T11:30:00.000Z',
          attendeeEmail: 'bob@x.com',
        }),
        adminDb,
      )

      const filtered = await listBookingsForDay(
        tenantId,
        agentId,
        '2026-05-25',
        'JANE@X.COM',
        adminDb,
      )
      expect(filtered.map((b) => b.attendeeEmail)).toEqual(['jane@x.com'])
    })
  })

  it('upsertBooking is scoped per tenant/agent (no cross-tenant leakage)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seed(adminDb)
      await upsertBooking(
        baseBooking({
          tenantId: a.tenantId,
          agentId: a.agentId,
          calendarConnectionId: a.connId,
          attendeeEmail: 'a@x.com',
        }),
        adminDb,
      )
      await upsertBooking(
        baseBooking({
          tenantId: b.tenantId,
          agentId: b.agentId,
          calendarConnectionId: b.connId,
          attendeeEmail: 'b@x.com',
        }),
        adminDb,
      )

      const aDay = await listBookingsForDay(a.tenantId, a.agentId, '2026-05-25', null, adminDb)
      expect(aDay.map((x) => x.attendeeEmail)).toEqual(['a@x.com'])
      const bDay = await listBookingsForDay(b.tenantId, b.agentId, '2026-05-25', null, adminDb)
      expect(bDay.map((x) => x.attendeeEmail)).toEqual(['b@x.com'])
    })
  })

  it('setBookingStatus is scoped to the tenant: another tenant cannot cancel the booking', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seed(adminDb)
      const created = await upsertBooking(
        baseBooking({
          tenantId: a.tenantId,
          agentId: a.agentId,
          calendarConnectionId: a.connId,
        }),
        adminDb,
      )
      // wrong tenant -> no-op
      await setBookingStatus(b.tenantId, created.id, { status: 'cancelled' }, adminDb)
      const stillActive = await listBookingsForDay(
        a.tenantId,
        a.agentId,
        '2026-05-25',
        null,
        adminDb,
      )
      expect(stillActive.length).toBe(1)
      expect(stillActive[0].status).toBe('confirmed')
    })
  })
})
