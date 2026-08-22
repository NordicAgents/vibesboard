import { describe, it, expect } from 'vitest'
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
  it('maps a row to the legacy HookDocument shape with ISO timestamps', () => {
    const doc = rowToHook(hookRow)
    expect(doc.id).toBe(hookRow.id)
    expect(doc.secretHash).toBe('deadbeef')
    expect(doc.requestCount).toBe(3)
    expect(doc.lastUsedAt).toBe(now.toISOString())
    expect(doc.createdAt).toBe(now.toISOString())
  })
  it('rowToHookSafe strips secretHash', () => {
    const safe = rowToHookSafe(hookRow)
    expect('secretHash' in safe).toBe(false)
    expect(safe.name).toBe('Negotiation Service')
  })
  it('null lastUsedAt maps to undefined', () => {
    const doc = rowToHook({ ...hookRow, lastUsedAt: null })
    expect(doc.lastUsedAt).toBe(undefined)
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
  it('maps a job row to the legacy HookJobDocument shape', () => {
    const doc = rowToHookJob(jobRow)
    expect(doc.id).toBe(jobRow.id)
    expect(doc.message).toBe('hello')
    expect(doc.callbackUrl).toBe('https://example.com/cb')
    expect(doc.status).toBe('pending')
    expect(doc.callbackAttempts).toBe(0)
    expect(doc.createdAt).toBe(now.toISOString())
  })
  it('null optional fields map to undefined', () => {
    const doc = rowToHookJob(jobRow)
    expect(doc.reply).toBe(undefined)
    expect(doc.error).toBe(undefined)
    expect(doc.callbackStatus).toBe(undefined)
    expect(doc.startedAt).toBe(undefined)
    expect(doc.completedAt).toBe(undefined)
    expect(doc.failedAt).toBe(undefined)
  })
})
