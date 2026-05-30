import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import CryptoJS from 'crypto-js'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, dataConnections } from '@vibesboard/adapter-postgres/schema'
import { eq } from 'drizzle-orm'
import { decryptToken } from '@vibesboard/scheduling/connections'
import { rowToDataConnection } from '../db.ts'
import {
  createDataConnection,
  getDataConnections,
  getDataConnection,
  updateDataConnection,
  updateDataConnectionStatus,
  deleteDataConnection,
} from '../connections.ts'

// connections.ts encrypts tokens with CryptoJS.AES using process.env.ENCRYPTION_KEY.
// Ensure it is set for the whole suite so encrypt/decrypt are deterministic.
const TEST_KEY = 'test-key-123'

beforeAll(() => {
  process.env.ENCRYPTION_KEY = TEST_KEY
})

async function seedTenantRow(adminDb: any) {
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
  return { u, t }
}

// ─── Pure mapping ─────────────────────────────────────────────────────

describe('rowToDataConnection', () => {
  const now = new Date('2026-05-25T00:00:00.000Z')

  function baseRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'd1',
      tenantId: 't1',
      provider: 'google_sheets',
      name: 'sheet',
      accessTokenEncrypted: 'enc-a',
      refreshTokenEncrypted: 'enc-r',
      tokenExpiresAt: now,
      email: 'a@b.com',
      spreadsheetId: 'ss1',
      sheetName: 'Sheet1',
      scopes: ['s'],
      apiTokenEncrypted: null,
      baseId: null,
      tableId: null,
      tableName: null,
      webhookUrl: null,
      webhookMethod: null,
      webhookHeaders: null,
      status: 'active',
      connectedBy: 'u1',
      connectedAt: now,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as any
  }

  it('maps a google_sheets row preserving ciphertext + optional fields', () => {
    const doc = rowToDataConnection(baseRow())
    expect(doc.accessToken).toBe('enc-a')
    expect(doc.refreshToken).toBe('enc-r')
    expect(doc.tokenExpiresAt).toBe(now.toISOString())
    expect(doc.spreadsheetId).toBe('ss1')
    expect(doc.sheetName).toBe('Sheet1')
    expect(doc.scopes).toEqual(['s'])
    // Airtable/webhook fields are null in the row → undefined in the doc.
    expect(doc.apiToken).toBeUndefined()
    expect(doc.baseId).toBeUndefined()
    expect(doc.webhookUrl).toBeUndefined()
  })

  it('converts all null optional fields to undefined', () => {
    const doc = rowToDataConnection(
      baseRow({
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        email: null,
        spreadsheetId: null,
        sheetName: null,
        scopes: null,
      }),
    )
    expect(doc.accessToken).toBeUndefined()
    expect(doc.refreshToken).toBeUndefined()
    expect(doc.tokenExpiresAt).toBeUndefined()
    expect(doc.email).toBeUndefined()
    expect(doc.spreadsheetId).toBeUndefined()
    expect(doc.sheetName).toBeUndefined()
    expect(doc.scopes).toBeUndefined()
  })

  it('defaults a null connectedBy to an empty string', () => {
    const doc = rowToDataConnection(baseRow({ connectedBy: null }))
    expect(doc.connectedBy).toBe('')
  })

  it('serializes timestamps to ISO strings', () => {
    const doc = rowToDataConnection(baseRow())
    expect(doc.connectedAt).toBe(now.toISOString())
    expect(doc.createdAt).toBe(now.toISOString())
    expect(doc.updatedAt).toBe(now.toISOString())
  })

  it('maps an airtable row preserving provider-specific fields', () => {
    const doc = rowToDataConnection(
      baseRow({
        provider: 'airtable',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        spreadsheetId: null,
        sheetName: null,
        scopes: null,
        apiTokenEncrypted: 'enc-api',
        baseId: 'b1',
        tableId: 'tbl1',
        tableName: 'Leads',
      }),
    )
    expect(doc.provider).toBe('airtable')
    expect(doc.apiToken).toBe('enc-api')
    expect(doc.baseId).toBe('b1')
    expect(doc.tableId).toBe('tbl1')
    expect(doc.tableName).toBe('Leads')
  })

  it('maps a custom_webhook row preserving headers + method', () => {
    const doc = rowToDataConnection(
      baseRow({
        provider: 'custom_webhook',
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
        tokenExpiresAt: null,
        spreadsheetId: null,
        sheetName: null,
        scopes: null,
        webhookUrl: 'https://example.com/hook',
        webhookMethod: 'PUT',
        webhookHeaders: { 'X-Token': 'abc' },
      }),
    )
    expect(doc.provider).toBe('custom_webhook')
    expect(doc.webhookUrl).toBe('https://example.com/hook')
    expect(doc.webhookMethod).toBe('PUT')
    expect(doc.webhookHeaders).toEqual({ 'X-Token': 'abc' })
  })
})

// ─── Crypto round-trip of stored credentials ──────────────────────────

describe('credential encryption round-trip', () => {
  it('createDataConnection stores the api token encrypted (not plaintext)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)

      const created = await createDataConnection(
        {
          provider: 'airtable',
          tenantId: t,
          apiToken: 'plain-token',
          baseId: 'b1',
          tableId: 'tbl1',
          tableName: 'Leads',
          connectedBy: u,
          name: 'AT',
        },
        adminDb,
      )

      // The returned doc carries the ciphertext, never the plaintext.
      expect(created.apiToken).not.toBe('plain-token')
      expect(typeof created.apiToken).toBe('string')

      // The persisted column is also ciphertext.
      const [row] = await adminDb
        .select()
        .from(dataConnections)
        .where(eq(dataConnections.id, created.id))
      expect(row.apiTokenEncrypted).not.toBe('plain-token')
      expect(row.apiTokenEncrypted).toBe(created.apiToken)

      // And it decrypts back to the original via the shared scheduling helper.
      expect(decryptToken(row.apiTokenEncrypted!)).toBe('plain-token')
    })
  })

  it('createDataConnection encrypts both google_sheets access + refresh tokens', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const expires = new Date(Date.now() + 3600_000).toISOString()

      const created = await createDataConnection(
        {
          provider: 'google_sheets',
          tenantId: t,
          accessToken: 'access-plain',
          refreshToken: 'refresh-plain',
          tokenExpiresAt: expires,
          email: 'me@example.com',
          spreadsheetId: 'ss1',
          sheetName: 'Sheet2',
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
          connectedBy: u,
          name: 'GS',
        },
        adminDb,
      )

      expect(created.accessToken).not.toBe('access-plain')
      expect(created.refreshToken).not.toBe('refresh-plain')
      expect(decryptToken(created.accessToken!)).toBe('access-plain')
      expect(decryptToken(created.refreshToken!)).toBe('refresh-plain')
      // Non-secret fields are stored verbatim.
      expect(created.spreadsheetId).toBe('ss1')
      expect(created.sheetName).toBe('Sheet2')
      expect(created.email).toBe('me@example.com')
      expect(created.scopes).toEqual([
        'https://www.googleapis.com/auth/spreadsheets',
      ])
    })
  })

  it('the encrypted blob is not byte-equal to the plaintext (CryptoJS AES)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'airtable',
          tenantId: t,
          apiToken: 'super-secret',
          baseId: 'b1',
          tableId: 'tbl1',
          connectedBy: u,
          name: 'AT',
        },
        adminDb,
      )
      const [row] = await adminDb
        .select()
        .from(dataConnections)
        .where(eq(dataConnections.id, created.id))
      // The stored ciphertext must not contain the plaintext substring.
      expect(row.apiTokenEncrypted).not.toContain('super-secret')
      // Cross-check the round-trip independently of the scheduling helper.
      const bytes = CryptoJS.AES.decrypt(row.apiTokenEncrypted!, TEST_KEY)
      expect(bytes.toString(CryptoJS.enc.Utf8)).toBe('super-secret')
    })
  })

  it('webhook connections persist no encrypted credential fields', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'custom_webhook',
          tenantId: t,
          webhookUrl: 'https://example.com/hook',
          webhookMethod: 'PUT',
          webhookHeaders: { 'X-Token': 'abc' },
          connectedBy: u,
          name: 'WH',
        },
        adminDb,
      )
      expect(created.webhookUrl).toBe('https://example.com/hook')
      expect(created.webhookMethod).toBe('PUT')
      expect(created.webhookHeaders).toEqual({ 'X-Token': 'abc' })
      expect(created.accessToken).toBeUndefined()
      expect(created.apiToken).toBeUndefined()
    })
  })
})

// ─── Default values on create ─────────────────────────────────────────

describe('createDataConnection defaults', () => {
  it('defaults sheetName to "Sheet1" for google_sheets', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'google_sheets',
          tenantId: t,
          accessToken: 'a',
          refreshToken: 'r',
          tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
          spreadsheetId: 'ss1',
          scopes: [],
          connectedBy: u,
          name: 'GS',
        },
        adminDb,
      )
      expect(created.sheetName).toBe('Sheet1')
    })
  })

  it('defaults webhookMethod to "POST" for custom_webhook', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'custom_webhook',
          tenantId: t,
          webhookUrl: 'https://example.com/hook',
          connectedBy: u,
          name: 'WH',
        },
        adminDb,
      )
      expect(created.webhookMethod).toBe('POST')
    })
  })

  it('sets status to "active" on create', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'airtable',
          tenantId: t,
          apiToken: 'tok',
          baseId: 'b',
          tableId: 'tbl',
          connectedBy: u,
          name: 'AT',
        },
        adminDb,
      )
      expect(created.status).toBe('active')
    })
  })
})

// ─── CRUD + tenant isolation ──────────────────────────────────────────

describe('data connection CRUD (postgres)', () => {
  it('airtable create → get → list → update → status → delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)

      const created = await createDataConnection(
        {
          provider: 'airtable',
          tenantId: t,
          apiToken: 'plain-token',
          baseId: 'b1',
          tableId: 'tbl1',
          tableName: 'Leads',
          connectedBy: u,
          name: 'AT',
        },
        adminDb,
      )
      expect(created.apiToken).not.toBe('plain-token') // encrypted

      expect((await getDataConnection(t, created.id, adminDb))?.id).toBe(
        created.id,
      )
      // Tenant isolation: another tenant cannot read this connection.
      expect(await getDataConnection(randomUUID(), created.id, adminDb)).toBeNull()
      expect((await getDataConnections(t, adminDb)).length).toBe(1)

      await updateDataConnection(t, created.id, { tableName: 'Customers' }, adminDb)
      expect((await getDataConnection(t, created.id, adminDb))?.tableName).toBe(
        'Customers',
      )

      await updateDataConnectionStatus(t, created.id, 'expired', adminDb)
      expect((await getDataConnection(t, created.id, adminDb))?.status).toBe(
        'expired',
      )

      await deleteDataConnection(t, created.id, adminDb)
      expect(await getDataConnection(t, created.id, adminDb)).toBeNull()
    })
  })

  it('getDataConnections only returns the requested tenant rows', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenantRow(adminDb)
      const b = await seedTenantRow(adminDb)

      await createDataConnection(
        {
          provider: 'airtable',
          tenantId: a.t,
          apiToken: 'tok-a',
          baseId: 'b',
          tableId: 'tbl',
          connectedBy: a.u,
          name: 'A1',
        },
        adminDb,
      )
      await createDataConnection(
        {
          provider: 'airtable',
          tenantId: a.t,
          apiToken: 'tok-a2',
          baseId: 'b',
          tableId: 'tbl',
          connectedBy: a.u,
          name: 'A2',
        },
        adminDb,
      )
      await createDataConnection(
        {
          provider: 'airtable',
          tenantId: b.t,
          apiToken: 'tok-b',
          baseId: 'b',
          tableId: 'tbl',
          connectedBy: b.u,
          name: 'B1',
        },
        adminDb,
      )

      const aRows = await getDataConnections(a.t, adminDb)
      const bRows = await getDataConnections(b.t, adminDb)
      expect(aRows.length).toBe(2)
      expect(aRows.every((r) => r.tenantId === a.t)).toBe(true)
      expect(bRows.length).toBe(1)
      expect(bRows[0].name).toBe('B1')
    })
  })

  it('updateDataConnectionStatus does not affect another tenant connection', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenantRow(adminDb)
      const b = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'airtable',
          tenantId: a.t,
          apiToken: 'tok',
          baseId: 'b',
          tableId: 'tbl',
          connectedBy: a.u,
          name: 'A1',
        },
        adminDb,
      )

      // Attempt to flip status using the wrong tenant id → no-op.
      await updateDataConnectionStatus(b.t, created.id, 'revoked', adminDb)
      expect((await getDataConnection(a.t, created.id, adminDb))?.status).toBe(
        'active',
      )
    })
  })

  it('deleteDataConnection scoped to the wrong tenant leaves the row intact', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenantRow(adminDb)
      const b = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'airtable',
          tenantId: a.t,
          apiToken: 'tok',
          baseId: 'b',
          tableId: 'tbl',
          connectedBy: a.u,
          name: 'A1',
        },
        adminDb,
      )

      await deleteDataConnection(b.t, created.id, adminDb)
      // Still present for the owning tenant.
      expect(await getDataConnection(a.t, created.id, adminDb)).not.toBeNull()
    })
  })

  it('updateDataConnection bumps updatedAt', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'custom_webhook',
          tenantId: t,
          webhookUrl: 'https://example.com/a',
          connectedBy: u,
          name: 'WH',
        },
        adminDb,
      )
      const before = (await getDataConnection(t, created.id, adminDb))!.updatedAt

      await updateDataConnection(
        t,
        created.id,
        { webhookUrl: 'https://example.com/b', name: 'WH2' },
        adminDb,
      )
      const after = (await getDataConnection(t, created.id, adminDb))!
      expect(after.webhookUrl).toBe('https://example.com/b')
      expect(after.name).toBe('WH2')
      expect(new Date(after.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before).getTime(),
      )
    })
  })
})

// ─── Token management (auto-refresh, external fetch stubbed) ───────────

describe('getValidDataAccessToken', () => {
  const realFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('returns the decrypted access token when not near expiry (no refresh)', async () => {
    const { getValidDataAccessToken } = await import('../connections.ts')
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'google_sheets',
          tenantId: t,
          accessToken: 'valid-access',
          refreshToken: 'the-refresh',
          tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
          spreadsheetId: 'ss1',
          scopes: [],
          connectedBy: u,
          name: 'GS',
        },
        adminDb,
      )
      const doc = (await getDataConnection(t, created.id, adminDb))!
      const token = await getValidDataAccessToken(doc, adminDb)
      expect(token).toBe('valid-access')
      // No refresh network call when the token is still valid.
      expect(fetchCalled).toBe(false)
    })
  })

  it('refreshes an expired google_sheets token (fetch stubbed) and persists it', async () => {
    const { getValidDataAccessToken } = await import('../connections.ts')
    let refreshUrl: string | undefined
    globalThis.fetch = (async (url: string) => {
      refreshUrl = typeof url === 'string' ? url : String(url)
      return new Response(
        JSON.stringify({ access_token: 'fresh-access', expires_in: 3600 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as unknown as typeof fetch

    // refreshAccessToken reads GOOGLE_SHEETS_CLIENT_ID/SECRET.
    process.env.GOOGLE_SHEETS_CLIENT_ID = 'cid'
    process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'csecret'

    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'google_sheets',
          tenantId: t,
          accessToken: 'stale-access',
          refreshToken: 'the-refresh',
          // Already expired → triggers a refresh.
          tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
          spreadsheetId: 'ss1',
          scopes: [],
          connectedBy: u,
          name: 'GS',
        },
        adminDb,
      )
      const doc = (await getDataConnection(t, created.id, adminDb))!
      const token = await getValidDataAccessToken(doc, adminDb)

      expect(token).toBe('fresh-access')
      expect(refreshUrl).toContain('oauth2.googleapis.com/token')

      // The new (encrypted) access token is persisted and decrypts back.
      const [row] = await adminDb
        .select()
        .from(dataConnections)
        .where(eq(dataConnections.id, created.id))
      expect(decryptToken(row.accessTokenEncrypted!)).toBe('fresh-access')
    })
  })

  it('marks the connection expired and throws when refresh fails', async () => {
    const { getValidDataAccessToken } = await import('../connections.ts')
    globalThis.fetch = (async () =>
      new Response('bad refresh', { status: 400 })) as unknown as typeof fetch
    process.env.GOOGLE_SHEETS_CLIENT_ID = 'cid'
    process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'csecret'

    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'google_sheets',
          tenantId: t,
          accessToken: 'stale',
          refreshToken: 'the-refresh',
          tokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
          spreadsheetId: 'ss1',
          scopes: [],
          connectedBy: u,
          name: 'GS',
        },
        adminDb,
      )
      const doc = (await getDataConnection(t, created.id, adminDb))!

      await expect(getValidDataAccessToken(doc, adminDb)).rejects.toThrow(
        /Google Sheets token refresh failed/,
      )
      // Side effect: the connection is now marked expired.
      expect((await getDataConnection(t, created.id, adminDb))?.status).toBe(
        'expired',
      )
    })
  })

  it('returns the decrypted api token for airtable (no network)', async () => {
    const { getValidDataAccessToken } = await import('../connections.ts')
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch

    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'airtable',
          tenantId: t,
          apiToken: 'pat-secret',
          baseId: 'b',
          tableId: 'tbl',
          connectedBy: u,
          name: 'AT',
        },
        adminDb,
      )
      const doc = (await getDataConnection(t, created.id, adminDb))!
      expect(await getValidDataAccessToken(doc, adminDb)).toBe('pat-secret')
      expect(fetchCalled).toBe(false)
    })
  })

  it('returns empty string for custom_webhook connections', async () => {
    const { getValidDataAccessToken } = await import('../connections.ts')
    await withTestDb(async ({ adminDb }) => {
      const { u, t } = await seedTenantRow(adminDb)
      const created = await createDataConnection(
        {
          provider: 'custom_webhook',
          tenantId: t,
          webhookUrl: 'https://example.com/hook',
          connectedBy: u,
          name: 'WH',
        },
        adminDb,
      )
      const doc = (await getDataConnection(t, created.id, adminDb))!
      expect(await getValidDataAccessToken(doc, adminDb)).toBe('')
    })
  })
})
