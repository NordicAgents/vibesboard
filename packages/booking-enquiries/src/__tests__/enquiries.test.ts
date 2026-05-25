import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { rowToBookingEnquiry } from '../db.ts'
import { createEnquiry } from '../create.ts'
import { listEnquiriesForAgent } from '../list.ts'

async function seedAgent(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  const a = randomUUID()
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
  return { tenantId: t, agentId: a }
}

describe('rowToBookingEnquiry', () => {
  test('maps an enquiry row to BookingEnquiryDocument', () => {
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
    assert.equal(doc.id, 'e1')
    assert.equal(doc.startDatetime, start.toISOString())
    assert.equal(doc.guestCount, 2)
  })
})

describe('enquiry create + list (postgres)', () => {
  test('createEnquiry persists and listEnquiriesForAgent returns it', async () => {
    delete process.env.RESEND_API_KEY // skip email
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seedAgent(adminDb)
      const agent = { id: agentId, tenantId } as any
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
      const list = await listEnquiriesForAgent(tenantId, agentId, 100, adminDb)
      assert.equal(list.length, 1)
      assert.equal(list[0].id, id)
      assert.equal(list[0].guestName, 'Ada')
      // toUtcDate normalization keeps the wall-clock stable through timestamptz.
      assert.equal(list[0].startDatetime, '2026-05-25T10:00:00.000Z')
    })
  })
})
