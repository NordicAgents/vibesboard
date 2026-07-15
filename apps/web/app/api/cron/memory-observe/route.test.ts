// Unit tests for POST /api/cron/memory-observe.
//
// The route guards with x-cron-secret, delegates all work to runMemoryObserve,
// and forwards the result as { ok: true, ...result }. We mock at the module
// boundary so no DB or AI calls are made.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ─────────────────────────────────────────────────────────────────────
// runMemoryObserveMock is declared before vi.mock() in source, but vi.mock()
// is hoisted by Vitest. The factory function is called lazily when the module
// is first imported (via the dynamic import below), by which time this variable
// is already initialised — the same pattern used across this codebase.

const runMemoryObserveMock = vi.fn()

vi.mock('@vibesboard/ai/agent-memory', () => ({
  runMemoryObserve: (...args: unknown[]) => runMemoryObserveMock(...args),
}))

vi.mock('@vibesboard/adapter-postgres/client', () => ({
  getMigrateDb: () => ({}),
}))

const { POST } = await import('./route.ts')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/cron/memory-observe', {
    method: 'POST',
    headers,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/cron/memory-observe', () => {
  beforeAll(() => {
    process.env.CRON_SECRET = 'test-secret'
  })

  beforeEach(() => {
    runMemoryObserveMock.mockReset()
  })

  it('returns 401 when x-cron-secret header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(runMemoryObserveMock).not.toHaveBeenCalled()
  })

  it('returns 401 when x-cron-secret header has the wrong value', async () => {
    const res = await POST(makeRequest({ 'x-cron-secret': 'wrong-secret' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(runMemoryObserveMock).not.toHaveBeenCalled()
  })

  it('returns 200 with processed count when the correct secret is provided', async () => {
    runMemoryObserveMock.mockResolvedValueOnce({ processed: 3 })
    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, processed: 3 })
  })

  it('returns 200 with processed: 0 when runMemoryObserve swallows an internal error', async () => {
    // runMemoryObserve is designed to catch errors internally and return { processed: 0 }
    // rather than re-throw — the route should still return 200 in that case.
    runMemoryObserveMock.mockResolvedValueOnce({ processed: 0 })
    const res = await POST(makeRequest({ 'x-cron-secret': 'test-secret' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, processed: 0 })
  })
})
