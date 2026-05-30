import { describe, it, expect } from 'vitest'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { seedTenantWithAgent } from '@vibesboard/test-helpers/factories'
import { rowToBookingEnquiry } from '../db.ts'
import { createEnquiry } from '../create.ts'
import { listEnquiriesForAgent } from '../list.ts'

describe('rowToBookingEnquiry', () => {
  it('maps an enquiry row to BookingEnquiryDocument', () => {
    const start = new Date('2026-05-25T10:00:00.000Z')
    const end = new Date('2026-05-25T12:00:00.000Z')
    const created = new Date('2026-05-24T00:00:00.000Z')
    const doc = rowToBookingEnquiry({
      id: 'e1',
      tenantId: 't1',
      agentId: 'a1',
      resourceName: 'Glass Cabin',
      calendarId: 'cal1',
      calendarName: 'Cabins',
      timezone: 'Europe/Stockholm',
      startDatetime: start,
      endDatetime: end,
      guestName: 'Ada',
      guestEmail: 'ada@x.com',
      guestPhone: '+46',
      guestCount: 2,
      notes: 'window seat',
      createdAt: created,
    })
    expect(doc.id).toBe('e1')
    expect(doc.tenantId).toBe('t1')
    expect(doc.agentId).toBe('a1')
    expect(doc.startDatetime).toBe(start.toISOString())
    expect(doc.endDatetime).toBe(end.toISOString())
    expect(doc.createdAt).toBe(created.toISOString())
    expect(doc.guestCount).toBe(2)
    expect(doc.notes).toBe('window seat')
  })

  it('coerces null guestCount and notes to undefined', () => {
    const now = new Date('2026-05-25T10:00:00.000Z')
    const doc = rowToBookingEnquiry({
      id: 'e2',
      tenantId: 't2',
      agentId: 'a2',
      resourceName: 'Room',
      calendarId: 'cal2',
      calendarName: 'Rooms',
      timezone: 'UTC',
      startDatetime: now,
      endDatetime: now,
      guestName: 'Bob',
      guestEmail: 'bob@x.com',
      guestPhone: '+1',
      guestCount: null,
      notes: null,
      createdAt: now,
    })
    expect(doc.guestCount).toBeUndefined()
    expect(doc.notes).toBeUndefined()
  })

  it('serialises all datetimes as ISO strings', () => {
    const start = new Date('2026-01-02T03:04:05.678Z')
    const end = new Date('2026-01-02T04:05:06.789Z')
    const created = new Date('2026-01-01T00:00:00.000Z')
    const doc = rowToBookingEnquiry({
      id: 'e3',
      tenantId: 't3',
      agentId: 'a3',
      resourceName: 'R',
      calendarId: 'c',
      calendarName: 'C',
      timezone: 'UTC',
      startDatetime: start,
      endDatetime: end,
      guestName: 'G',
      guestEmail: 'g@x.com',
      guestPhone: '+1',
      guestCount: 1,
      notes: 'n',
      createdAt: created,
    })
    expect(typeof doc.startDatetime).toBe('string')
    expect(doc.startDatetime).toBe('2026-01-02T03:04:05.678Z')
    expect(doc.endDatetime).toBe('2026-01-02T04:05:06.789Z')
    expect(doc.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('enquiry create + list (postgres)', () => {
  it('createEnquiry persists and listEnquiriesForAgent returns it', async () => {
    delete process.env.RESEND_API_KEY // skip email
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const agent = { id: agentId, tenantId, name: 'A' } as never
      const id = await createEnquiry(
        {
          agent,
          resourceName: 'Glass Cabin',
          calendarId: 'cal1',
          calendarName: 'Cabins',
          timezone: 'UTC',
          startDatetime: '2026-05-25T10:00:00.000Z',
          endDatetime: '2026-05-25T12:00:00.000Z',
          guestName: 'Ada',
          guestEmail: 'ada@x.com',
          guestPhone: '+46',
          guestCount: 2,
          notes: 'window',
        },
        adminDb,
      )
      expect(typeof id).toBe('string')
      const list = await listEnquiriesForAgent(tenantId, agentId, 100, adminDb)
      expect(list.length).toBe(1)
      expect(list[0].id).toBe(id)
      expect(list[0].guestName).toBe('Ada')
      expect(list[0].guestCount).toBe(2)
      expect(list[0].notes).toBe('window')
      // toUtcDate normalization keeps the wall-clock stable through timestamptz.
      expect(list[0].startDatetime).toBe('2026-05-25T10:00:00.000Z')
      expect(list[0].endDatetime).toBe('2026-05-25T12:00:00.000Z')
    })
  })

  it('treats a tz-less wall-clock datetime as UTC on the round-trip', async () => {
    delete process.env.RESEND_API_KEY
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const agent = { id: agentId, tenantId, name: 'A' } as never
      await createEnquiry(
        {
          agent,
          resourceName: 'Cabin',
          calendarId: 'c',
          calendarName: 'C',
          timezone: 'Asia/Kolkata',
          // No Z / offset — create.ts appends Z so the value is stable.
          startDatetime: '2026-05-10T14:00',
          endDatetime: '2026-05-10T16:00',
          guestName: 'Tz',
          guestEmail: 'tz@x.com',
          guestPhone: '+1',
        },
        adminDb,
      )
      const [doc] = await listEnquiriesForAgent(tenantId, agentId, 100, adminDb)
      expect(doc.startDatetime).toBe('2026-05-10T14:00:00.000Z')
      expect(doc.endDatetime).toBe('2026-05-10T16:00:00.000Z')
    })
  })

  it('persists nullable guestCount/notes as omitted (undefined) fields', async () => {
    delete process.env.RESEND_API_KEY
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const agent = { id: agentId, tenantId, name: 'A' } as never
      await createEnquiry(
        {
          agent,
          resourceName: 'Cabin',
          calendarId: 'c',
          calendarName: 'C',
          timezone: 'UTC',
          startDatetime: '2026-05-10T14:00:00.000Z',
          endDatetime: '2026-05-10T16:00:00.000Z',
          guestName: 'Minimal',
          guestEmail: 'min@x.com',
          guestPhone: '+1',
        },
        adminDb,
      )
      const [doc] = await listEnquiriesForAgent(tenantId, agentId, 100, adminDb)
      expect(doc.guestCount).toBeUndefined()
      expect(doc.notes).toBeUndefined()
    })
  })

  it('lists multiple enquiries newest-first', async () => {
    delete process.env.RESEND_API_KEY
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const agent = { id: agentId, tenantId, name: 'A' } as never
      const base = {
        agent,
        resourceName: 'Cabin',
        calendarId: 'c',
        calendarName: 'C',
        timezone: 'UTC',
        startDatetime: '2026-05-10T14:00:00.000Z',
        endDatetime: '2026-05-10T16:00:00.000Z',
        guestPhone: '+1',
      }
      const id1 = await createEnquiry(
        { ...base, guestName: 'First', guestEmail: 'first@x.com' },
        adminDb,
      )
      const id2 = await createEnquiry(
        { ...base, guestName: 'Second', guestEmail: 'second@x.com' },
        adminDb,
      )
      const list = await listEnquiriesForAgent(tenantId, agentId, 100, adminDb)
      expect(list.length).toBe(2)
      const ids = list.map((e) => e.id)
      expect(ids).toContain(id1)
      expect(ids).toContain(id2)
      // Ordered by createdAt desc.
      expect(new Date(list[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(list[1].createdAt).getTime(),
      )
    })
  })

  it('honours the limit argument', async () => {
    delete process.env.RESEND_API_KEY
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const agent = { id: agentId, tenantId, name: 'A' } as never
      const base = {
        agent,
        resourceName: 'Cabin',
        calendarId: 'c',
        calendarName: 'C',
        timezone: 'UTC',
        startDatetime: '2026-05-10T14:00:00.000Z',
        endDatetime: '2026-05-10T16:00:00.000Z',
        guestPhone: '+1',
      }
      for (let i = 0; i < 3; i++) {
        await createEnquiry(
          { ...base, guestName: `G${i}`, guestEmail: `g${i}@x.com` },
          adminDb,
        )
      }
      const limited = await listEnquiriesForAgent(tenantId, agentId, 2, adminDb)
      expect(limited.length).toBe(2)
    })
  })

  it('scopes the list to the (tenant, agent) pair', async () => {
    delete process.env.RESEND_API_KEY
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenantWithAgent(adminDb)
      const b = await seedTenantWithAgent(adminDb)
      const agentA = { id: a.agentId, tenantId: a.tenantId, name: 'A' } as never
      await createEnquiry(
        {
          agent: agentA,
          resourceName: 'Cabin',
          calendarId: 'c',
          calendarName: 'C',
          timezone: 'UTC',
          startDatetime: '2026-05-10T14:00:00.000Z',
          endDatetime: '2026-05-10T16:00:00.000Z',
          guestName: 'A-only',
          guestEmail: 'aonly@x.com',
          guestPhone: '+1',
        },
        adminDb,
      )
      // Agent B (different tenant + agent) sees nothing.
      const listB = await listEnquiriesForAgent(b.tenantId, b.agentId, 100, adminDb)
      expect(listB.length).toBe(0)
      const listA = await listEnquiriesForAgent(a.tenantId, a.agentId, 100, adminDb)
      expect(listA.length).toBe(1)
    })
  })

  it('does not return an enquiry when the agentId matches but the tenant differs', async () => {
    delete process.env.RESEND_API_KEY
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedTenantWithAgent(adminDb)
      const agent = { id: agentId, tenantId, name: 'A' } as never
      await createEnquiry(
        {
          agent,
          resourceName: 'Cabin',
          calendarId: 'c',
          calendarName: 'C',
          timezone: 'UTC',
          startDatetime: '2026-05-10T14:00:00.000Z',
          endDatetime: '2026-05-10T16:00:00.000Z',
          guestName: 'Real',
          guestEmail: 'real@x.com',
          guestPhone: '+1',
        },
        adminDb,
      )
      // Right agent id, wrong tenant id => no rows (tenant-isolation guard).
      const wrongTenant = await listEnquiriesForAgent(
        '00000000-0000-0000-0000-000000000000',
        agentId,
        100,
        adminDb,
      )
      expect(wrongTenant.length).toBe(0)
    })
  })
})
