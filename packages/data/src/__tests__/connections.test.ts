import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToDataConnection } from '../db.ts'

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
