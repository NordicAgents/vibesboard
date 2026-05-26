import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { rowToHook, rowToHookSafe, rowToHookJob } from '../db.ts'

const now = new Date('2026-05-25T00:00:00.000Z')

const hookRow = {
  id: '0190a0aa-0000-7000-8000-000000000001',
  tenantId: 't1',
  agentId: 'a1',
  name: 'Negotiation Service',
  secretHash: 'deadbeef',
  status: 'active' as const,
  requestCount: 3,
  lastUsedAt: now,
  createdAt: now,
  updatedAt: now
}

describe('rowToHook', () => {
  test('maps a row to the legacy HookDocument shape with ISO timestamps', () => {
    const doc = rowToHook(hookRow)
    assert.equal(doc.id, hookRow.id)
    assert.equal(doc.secretHash, 'deadbeef')
    assert.equal(doc.requestCount, 3)
    assert.equal(doc.lastUsedAt, now.toISOString())
    assert.equal(doc.createdAt, now.toISOString())
  })
  test('rowToHookSafe strips secretHash', () => {
    const safe = rowToHookSafe(hookRow)
    assert.equal('secretHash' in safe, false)
    assert.equal(safe.name, 'Negotiation Service')
  })
  test('null lastUsedAt maps to undefined', () => {
    const doc = rowToHook({ ...hookRow, lastUsedAt: null })
    assert.equal(doc.lastUsedAt, undefined)
  })
})

const jobRow = {
  id: '0190a0aa-0000-7000-8000-000000000002',
  tenantId: 't1',
  hookId: 'h1',
  agentId: 'a1',
  message: 'hello',
  externalUserId: 'ext1',
  conversationId: 'c1',
  callbackUrl: 'https://example.com/cb',
  status: 'pending' as const,
  reply: null,
  error: null,
  callbackStatus: null,
  callbackAttempts: 0,
  createdAt: now,
  startedAt: null,
  completedAt: null,
  failedAt: null
}

describe('rowToHookJob', () => {
  test('maps a job row to the legacy HookJobDocument shape', () => {
    const doc = rowToHookJob(jobRow)
    assert.equal(doc.id, jobRow.id)
    assert.equal(doc.message, 'hello')
    assert.equal(doc.callbackUrl, 'https://example.com/cb')
    assert.equal(doc.status, 'pending')
    assert.equal(doc.callbackAttempts, 0)
    assert.equal(doc.createdAt, now.toISOString())
  })
  test('null optional fields map to undefined', () => {
    const doc = rowToHookJob(jobRow)
    assert.equal(doc.reply, undefined)
    assert.equal(doc.error, undefined)
    assert.equal(doc.callbackStatus, undefined)
    assert.equal(doc.startedAt, undefined)
    assert.equal(doc.completedAt, undefined)
    assert.equal(doc.failedAt, undefined)
  })
})
