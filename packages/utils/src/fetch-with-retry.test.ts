import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWithRetry } from './fetch-with-retry.ts'

/**
 * Build a Response-like stub. We avoid the real Response constructor so we can
 * use arbitrary statuses and attach a fake `headers.get` for Retry-After.
 */
function makeResponse(status: number, retryAfter?: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null,
    },
  } as unknown as Response
}

/**
 * The real fetchWithRetry uses an internal (non-injectable) setTimeout-based
 * backoff and a per-attempt timeout. For the behavioral tests we run with REAL
 * timers but force `baseDelayMs: 0` so backoff is effectively instant and the
 * tests stay fast and deterministic. The two suites that specifically assert
 * backoff timing / timeout behavior opt into fake timers locally.
 */
describe('fetchWithRetry', () => {
  const realFetch = globalThis.fetch
  // Zero backoff + a generous timeout that never fires during these fast tests.
  const fast = { baseDelayMs: 0, timeoutMs: 60_000 } as const

  afterEach(() => {
    globalThis.fetch = realFetch
    vi.restoreAllMocks()
  })

  describe('success paths', () => {
    it('returns the first response when it is a non-retry status', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(200))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', fast)

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not retry on 4xx client errors other than 429', async () => {
      for (const status of [400, 401, 403, 404, 418]) {
        const fetchMock = vi.fn().mockResolvedValue(makeResponse(status))
        globalThis.fetch = fetchMock as unknown as typeof fetch

        const res = await fetchWithRetry('https://example.com', fast)
        expect(res.status).toBe(status)
        expect(fetchMock).toHaveBeenCalledTimes(1)
      }
    })

    it('retries once then succeeds on a transient 503', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(503))
        .mockResolvedValueOnce(makeResponse(200))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', fast)

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('retryable statuses', () => {
    it.each([429, 500, 502, 503, 504])('retries on %i', async (status) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(status))
        .mockResolvedValueOnce(makeResponse(200))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', fast)

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does NOT retry on 501 (not in the retryable set)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(501))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', fast)

      expect(res.status).toBe(501)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('retry exhaustion on retryable statuses', () => {
    it('retries up to maxAttempts (default 3) and returns the last 500 response', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(500))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', fast)

      expect(res.status).toBe(500)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('honors a custom maxAttempts', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(502))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', {
        ...fast,
        maxAttempts: 5,
      })

      expect(res.status).toBe(502)
      expect(fetchMock).toHaveBeenCalledTimes(5)
    })

    it('with maxAttempts=1 performs a single attempt and no retry', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(500))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', {
        ...fast,
        maxAttempts: 1,
      })

      expect(res.status).toBe(500)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('network error handling', () => {
    it('retries on a thrown network error then succeeds', async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValueOnce(makeResponse(200))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const res = await fetchWithRetry('https://example.com', fast)

      expect(res.status).toBe(200)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('throws the last network error after exhausting attempts', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      await expect(fetchWithRetry('https://example.com', fast)).rejects.toThrow(
        /network down/,
      )
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('throws immediately on a single attempt (maxAttempts=1) network error', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('one shot'))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      await expect(
        fetchWithRetry('https://example.com', { ...fast, maxAttempts: 1 }),
      ).rejects.toThrow(/one shot/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not retry when the caller already aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const fetchMock = vi.fn(() => {
        const err = new Error('caller aborted')
        err.name = 'AbortError'
        return Promise.reject(err)
      })
      globalThis.fetch = fetchMock as unknown as typeof fetch

      await expect(
        fetchWithRetry('https://example.com', {
          ...fast,
          signal: controller.signal,
          maxAttempts: 3,
        }),
      ).rejects.toThrow()
      // Caller-aborted should short-circuit: a single attempt, no retries.
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('exponential backoff timing (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    })

    it('waits baseDelayMs * 2^attempt between retries (default base 500)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(500))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const promise = fetchWithRetry('https://example.com')
      // Avoid an unhandled rejection if the assertion path throws early.
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // First backoff is 500 * 2^0 = 500ms.
      await vi.advanceTimersByTimeAsync(499)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // Second backoff is 500 * 2^1 = 1000ms.
      await vi.advanceTimersByTimeAsync(999)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(3)

      const res = await promise
      expect(res.status).toBe(500)
    })

    it('uses a custom baseDelayMs', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(500))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const promise = fetchWithRetry('https://example.com', { baseDelayMs: 100 })
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // 100 * 2^0 = 100ms backoff before attempt 2.
      await vi.advanceTimersByTimeAsync(99)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(500)
      await promise
    })

    it('respects a numeric Retry-After header on a 429 (seconds -> ms)', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(429, '2'))
        .mockResolvedValueOnce(makeResponse(200))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const promise = fetchWithRetry('https://example.com')

      await vi.advanceTimersByTimeAsync(0)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // Retry-After "2" seconds -> 2000ms, overriding the 500ms base backoff.
      await vi.advanceTimersByTimeAsync(1999)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(fetchMock).toHaveBeenCalledTimes(2)

      const res = await promise
      expect(res.status).toBe(200)
    })
  })

  describe('timeout handling (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.runOnlyPendingTimers()
      vi.useRealTimers()
    })

    it('aborts a slow request after timeoutMs and surfaces a timeout error', async () => {
      // fetch never resolves on its own; it rejects with an AbortError when the
      // injected controller fires. We reject from the passed signal's abort event.
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        })
      })
      globalThis.fetch = fetchMock as unknown as typeof fetch

      const promise = fetchWithRetry('https://example.com', {
        timeoutMs: 1000,
        maxAttempts: 1,
      })
      const assertion = expect(promise).rejects.toThrow(/timed out after 1000ms/)
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('request forwarding', () => {
    it('forwards method/headers/body to fetch and strips retry-only options', async () => {
      const fetchMock = vi.fn().mockResolvedValue(makeResponse(200))
      globalThis.fetch = fetchMock as unknown as typeof fetch

      await fetchWithRetry('https://api.example.com/x', {
        ...fast,
        maxAttempts: 3,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 }),
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [calledUrl, calledInit] = fetchMock.mock.calls[0]
      expect(calledUrl).toBe('https://api.example.com/x')
      expect(calledInit.method).toBe('POST')
      expect(calledInit.headers).toEqual({ 'content-type': 'application/json' })
      expect(calledInit.body).toBe(JSON.stringify({ a: 1 }))
      // A signal is always injected for the timeout.
      expect(calledInit.signal).toBeInstanceOf(AbortSignal)
      // Retry-only options must not leak into the fetch init.
      expect(calledInit.maxAttempts).toBeUndefined()
      expect(calledInit.baseDelayMs).toBeUndefined()
      expect(calledInit.timeoutMs).toBeUndefined()
    })
  })
})
