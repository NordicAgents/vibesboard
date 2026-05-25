import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import { rowToDataConnection } from '../db.ts'
import {
  createDataConnection,
  getDataConnections,
  getDataConnection,
  updateDataConnection,
  updateDataConnectionStatus,
  deleteDataConnection,
} from '../connections.ts'

describe('rowToDataConnection', () => {
  test('maps a google_sheets row preserving ciphertext + optional fields', () => {
    const now = new Date('2026-05-25T00:00:00.000Z')
    const doc = rowToDataConnection({
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
    })
    assert.equal(doc.accessToken, 'enc-a')
    assert.equal(doc.tokenExpiresAt, now.toISOString())
    assert.equal(doc.spreadsheetId, 'ss1')
    assert.equal(doc.apiToken, undefined)
  })
})

describe('data connection CRUD (postgres)', () => {
  test('airtable create → get → list → update → status → delete', async () => {
    process.env.ENCRYPTION_KEY = 'test-key-123'
    await withTestDb(async ({ adminDb }) => {
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
      assert.notEqual(created.apiToken, 'plain-token') // encrypted

      assert.equal((await getDataConnection(t, created.id, adminDb))?.id, created.id)
      assert.equal(await getDataConnection(randomUUID(), created.id, adminDb), null) // isolation
      assert.equal((await getDataConnections(t, adminDb)).length, 1)

      await updateDataConnection(t, created.id, { tableName: 'Customers' }, adminDb)
      assert.equal(
        (await getDataConnection(t, created.id, adminDb))?.tableName,
        'Customers',
      )

      await updateDataConnectionStatus(t, created.id, 'expired', adminDb)
      assert.equal(
        (await getDataConnection(t, created.id, adminDb))?.status,
        'expired',
      )

      await deleteDataConnection(t, created.id, adminDb)
      assert.equal(await getDataConnection(t, created.id, adminDb), null)
    })
  })
})
