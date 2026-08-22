import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { tenants, users } from '@vibesboard/adapter-postgres/schema'

import { rowToBooking, rowToCalendarConnection } from '../db.ts'
import {
  createCalendarConnection,
  decryptToken,
  deleteCalendarConnection,
  getCalendarConnection,
  getCalendarConnections,
  getValidAccessToken,
  updateConnectionStatus,
  type CreateConnectionParams,
} from '../connections.ts'

// ENCRYPTION_KEY is provided by the shared test setup (test/setup/env.ts);
// set it defensively here too so these specs are self-contained.
process.env.ENCRYPTION_KEY ??= 'test-encryption-key-32-bytes-long!!'

describe('rowToCalendarConnection', () => {
  it('maps a row to the legacy CalendarConnectionDocument shape (tokens stay ciphertext)', () => {
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
    } as any)
    expect(doc.id).toBe('c1')
    // mapper does NOT decrypt; it passes the encrypted values straight through
    expect(doc.accessToken).toBe('enc-access')
    expect(doc.refreshToken).toBe('enc-refresh')
    expect(doc.tokenExpiresAt).toBe(now.toISOString())
    expect(doc.scopes[0]).toBe('https://www.googleapis.com/auth/calendar')
    expect(doc.apiKey).toBe(undefined)
  })

  it('defaults a null tokenExpiresAt to the epoch ISO string', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const doc = rowToCalendarConnection({
      id: 'c2',
      tenantId: 't1',
      provider: 'google_calendar',
      name: 'work',
      calendarId: 'primary',
      accessTokenEncrypted: 'a',
      refreshTokenEncrypted: 'r',
      tokenExpiresAt: null,
      apiKeyEncrypted: 'enc-api',
      apiBaseUrl: 'https://api',
      email: null,
      scopes: null,
      status: 'active',
      connectedBy: null,
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
    } as any)
    expect(doc.tokenExpiresAt).toBe(new Date(0).toISOString())
    expect(doc.apiKey).toBe('enc-api')
    expect(doc.apiBaseUrl).toBe('https://api')
    expect(doc.email).toBe(undefined)
    expect(doc.scopes).toEqual([])
    expect(doc.connectedBy).toBe('')
  })
})

describe('rowToBooking', () => {
  it('maps a booking row to BookingDocument (null conversationId -> empty string)', () => {
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
    } as any)
    expect(doc.id).toBe('b1')
    expect(doc.conversationId).toBe('') // null -> '' (contract is non-optional string)
    expect(doc.startTime).toBe(now.toISOString())
    expect(doc.endTime).toBe(end.toISOString())
    expect(doc.status).toBe('confirmed')
    expect(doc.description).toBe(undefined)
    expect(doc.cancelledAt).toBe(undefined)
  })
})

describe('token encryption', () => {
  it('encrypts on write and decryptToken round-trips back to plaintext', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createCalendarConnection(
        connParams({ tenantId, connectedBy: userId, accessToken: 'plain-access' }),
        adminDb,
      )
      // stored value is ciphertext, not the plaintext
      expect(created.accessToken).not.toBe('plain-access')
      // and it round-trips through decryptToken
      expect(decryptToken(created.accessToken)).toBe('plain-access')
      expect(decryptToken(created.refreshToken)).toBe('plain-refresh')
    })
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

const connParams = (
  over: Partial<CreateConnectionParams> = {},
): CreateConnectionParams =>
  ({
    provider: 'google_calendar' as const,
    name: 'work',
    calendarId: 'primary',
    accessToken: 'plain-access',
    refreshToken: 'plain-refresh',
    tokenExpiresAt: '2030-01-01T00:00:00.000Z',
    email: 'a@b.com',
    scopes: ['s'],
    ...over,
  }) as CreateConnectionParams

describe('calendar connection CRUD (postgres)', () => {
  it('create -> get -> list -> updateStatus -> delete, tenant-scoped', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createCalendarConnection(
        connParams({ tenantId, connectedBy: userId }),
        adminDb,
      )
      expect(created.id).toBeTruthy()
      expect(created.status).toBe('active') // default applied on insert
      expect(created.accessToken).not.toBe('plain-access') // stored encrypted

      const got = await getCalendarConnection(tenantId, created.id, adminDb)
      expect(got?.id).toBe(created.id)

      // tenant isolation: another tenant cannot see this connection
      const wrong = await getCalendarConnection(randomUUID(), created.id, adminDb)
      expect(wrong).toBe(null)

      const list = await getCalendarConnections(tenantId, adminDb)
      expect(list.length).toBe(1)

      await updateConnectionStatus(tenantId, created.id, 'expired', adminDb)
      const afterStatus = await getCalendarConnection(tenantId, created.id, adminDb)
      expect(afterStatus?.status).toBe('expired')

      await deleteCalendarConnection(tenantId, created.id, adminDb)
      expect(await getCalendarConnection(tenantId, created.id, adminDb)).toBe(null)
    })
  })

  it('getCalendarConnection returns null for a non-existent id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      expect(await getCalendarConnection(tenantId, randomUUID(), adminDb)).toBe(null)
    })
  })

  it('getCalendarConnections only returns the tenant\'s own connections', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenant(adminDb)
      const b = await seedTenant(adminDb)
      await createCalendarConnection(
        connParams({ tenantId: a.tenantId, connectedBy: a.userId, name: 'a-cal' }),
        adminDb,
      )
      await createCalendarConnection(
        connParams({ tenantId: b.tenantId, connectedBy: b.userId, name: 'b-cal' }),
        adminDb,
      )

      const aList = await getCalendarConnections(a.tenantId, adminDb)
      expect(aList.map((c) => c.name)).toEqual(['a-cal'])
      const bList = await getCalendarConnections(b.tenantId, adminDb)
      expect(bList.map((c) => c.name)).toEqual(['b-cal'])
    })
  })

  it('updateConnectionStatus is tenant-scoped: another tenant cannot change status', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenant(adminDb)
      const b = await seedTenant(adminDb)
      const created = await createCalendarConnection(
        connParams({ tenantId: a.tenantId, connectedBy: a.userId }),
        adminDb,
      )
      await updateConnectionStatus(b.tenantId, created.id, 'disconnected', adminDb)
      const unchanged = await getCalendarConnection(a.tenantId, created.id, adminDb)
      expect(unchanged?.status).toBe('active')
    })
  })

  it('deleteCalendarConnection is tenant-scoped: another tenant cannot delete it', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenant(adminDb)
      const b = await seedTenant(adminDb)
      const created = await createCalendarConnection(
        connParams({ tenantId: a.tenantId, connectedBy: a.userId }),
        adminDb,
      )
      await deleteCalendarConnection(b.tenantId, created.id, adminDb)
      // still present for the real owner
      expect(await getCalendarConnection(a.tenantId, created.id, adminDb)).not.toBe(null)
    })
  })
})

describe('getValidAccessToken', () => {
  it('returns the decrypted access token when it is comfortably in the future', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, userId } = await seedTenant(adminDb)
      const created = await createCalendarConnection(
        connParams({
          tenantId,
          connectedBy: userId,
          accessToken: 'still-good',
          tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
        adminDb,
      )
      const token = await getValidAccessToken(created, adminDb)
      expect(token).toBe('still-good')
    })
  })
})
