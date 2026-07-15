// Unit tests for POST /api/cron/memory-reconcile.
//
// Same guard pattern as memory-observe: x-cron-secret header, delegates to
// runMemoryReconcile, and returns { ok: true, ...result }. All external deps
// are mocked at the module boundary.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────

const runMemoryReconcileMock = vi.fn()

vi.mock('@vibesboard/ai/agent-memory', () => ({
  runMemoryReconcile: (...args: unknown[]) => runMemoryReconcileMock(...args),
}))

vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: () => ({}),
}))

const { POST } = await import('./route.ts')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/cron/memory-reconcile', {
    method: 'POST',
    headers,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/cron/memory-reconcile', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  beforeEach(() => {
    runMemoryReconcileMock.mockReset()
  })

  it('returns 401 when x-cron-secret header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(runMemoryReconcileMock).not.toHaveBeenCalled()
  })

  it('returns 401 when x-cron-secret header has the wrong value', async () => {
    const res = await POST(makeRequest({ 'x-cron-secret': 'wrong-secret' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(runMemoryReconcileMock).not.toHaveBeenCalled()
  })

  it('returns 200 with processed and mutated counts when the correct secret is provided', async () => {
    runMemoryReconcileMock.mockResolvedValueOnce({ processed: 5, mutated: 2 })
    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, processed: 5, mutated: 2 })
  })
})
