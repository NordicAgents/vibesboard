import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import { rowToCalendarConnection, rowToBooking } from '../db.ts'
import {
  createCalendarConnection,
  getCalendarConnections,
  getCalendarConnection,
  updateConnectionStatus,
  deleteCalendarConnection,
} from '../connections.ts'

describe('rowToCalendarConnection', () => {
  test('maps a row to the legacy CalendarConnectionDocument shape', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const doc = rowToCalendarConnection({
      id: 'c1',
      tenantId: 't1',
      provider: 'google_calendar',
      name: 'work',
      calendarId: 'primary',
      accessTokenEncrypted: 'enc-access',
      refreshTokenEncrypted: 'enc-refresh',
      tokenExpiresAt: now,
      apiKeyEncrypted: null,
      apiBaseUrl: null,
      email: 'a@b.com',
      scopes: ['https://www.googleapis.com/auth/calendar'],
      status: 'active',
      connectedBy: 'u1',
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    assert.equal(doc.id, 'c1')
    assert.equal(doc.accessToken, 'enc-access') // still ciphertext
    assert.equal(doc.refreshToken, 'enc-refresh')
    assert.equal(doc.tokenExpiresAt, now.toISOString())
    assert.equal(doc.scopes[0], 'https://www.googleapis.com/auth/calendar')
    assert.equal(doc.apiKey, undefined)
  })
})

async function seedTenant(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false,
  })
  return { tenantId: t, userId: u }
}

describe('calendar connection CRUD (postgres)', () => {
  test('create → get → list → updateStatus → delete, tenant-scoped', async () => {
    process.env.ENCRYPTION_KEY = 'test-key-123'
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createCalendarConnection(
        {
          tenantId,
          provider: 'google_calendar',
          name: 'work',
          calendarId: 'primary',
          accessToken: 'plain-access',
          refreshToken: 'plain-refresh',
          tokenExpiresAt: '2030-01-01T00:00:00.000Z',
          email: 'a@b.com',
          scopes: ['s'],
          connectedBy: userId,
        },
        adminDb,
      )
      assert.notEqual(created.accessToken, 'plain-access') // stored encrypted

      const got = await getCalendarConnection(tenantId, created.id, adminDb)
      assert.equal(got?.id, created.id)

      // tenant isolation: wrong tenant cannot see it
      const wrong = await getCalendarConnection(randomUUID(), created.id, adminDb)
      assert.equal(wrong, null)

      const list = await getCalendarConnections(tenantId, adminDb)
      assert.equal(list.length, 1)

      await updateConnectionStatus(tenantId, created.id, 'expired', adminDb)
      const afterStatus = await getCalendarConnection(tenantId, created.id, adminDb)
      assert.equal(afterStatus?.status, 'expired')

      await deleteCalendarConnection(tenantId, created.id, adminDb)
      assert.equal(await getCalendarConnection(tenantId, created.id, adminDb), null)
    })
  })
})

describe('rowToBooking', () => {
  test('maps a booking row to BookingDocument', () => {
    const now = new Date('2026-05-25T10:00:00.000Z')
    const end = new Date('2026-05-25T10:30:00.000Z')
    const doc = rowToBooking({
      id: 'b1',
      tenantId: 't1',
      agentId: 'a1',
      conversationId: null,
      calendarConnectionId: 'c1',
      provider: 'google_calendar',
      externalEventId: 'evt1',
      title: 'Call',
      startTime: now,
      endTime: end,
      timezone: 'UTC',
      attendeeName: 'Jane',
      attendeeEmail: 'jane@x.com',
      description: null,
      meetLink: null,
      status: 'confirmed',
      cancelledAt: null,
      rescheduledTo: null,
      createdAt: now,
      updatedAt: now,
    })
    assert.equal(doc.id, 'b1')
    assert.equal(doc.conversationId, '') // null → '' (contract is non-optional string)
    assert.equal(doc.startTime, now.toISOString())
    assert.equal(doc.status, 'confirmed')
  })
})
