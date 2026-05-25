import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToBookingEnquiry } from '../db.ts'

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
