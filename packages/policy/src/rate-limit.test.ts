import { describe, expect, it } from 'vitest'

import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  consumeRateLimit,
  getTrustedClientAddress
} from './rate-limit.ts'

describe('getTrustedClientAddress', () => {
  it('uses the client address appended immediately before the load balancer', () => {
    const headers = new Headers({
      'x-forwarded-for': 'spoofed, 203.0.113.10, 35.191.0.1'
    })

    expect(getTrustedClientAddress(headers)).toBe('203.0.113.10')
  })

  it('falls back to the single forwarded address for local proxies', () => {
    expect(
      getTrustedClientAddress(
        new Headers({ 'x-forwarded-for': '203.0.113.11' })
      )
    ).toBe('203.0.113.11')
  })
})

describe('consumeRateLimit (postgres)', () => {
  it('allows only the configured number of requests in a window', async () => {
    await withTestDb(async ({ adminDb }) => {
      const options = {
        scope: 'test-route',
        identifier: 'visitor-1',
        salt: 'test-rate-limit-salt-that-is-long-enough',
        limit: 2,
        windowMs: 60_000,
        now: new Date('2026-08-12T12:00:30.000Z'),
        db: adminDb
      }

      expect((await consumeRateLimit(options)).allowed).toBe(true)
      expect((await consumeRateLimit(options)).allowed).toBe(true)
      const rejected = await consumeRateLimit(options)
      expect(rejected.allowed).toBe(false)
      expect(rejected.remaining).toBe(0)
      expect(rejected.resetAt.toISOString()).toBe('2026-08-12T12:01:00.000Z')
    })
  })

  it('is atomic under concurrent requests', async () => {
    await withTestDb(async ({ adminDb }) => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          consumeRateLimit({
            scope: 'concurrent-route',
            identifier: 'visitor-2',
            salt: 'test-rate-limit-salt-that-is-long-enough',
            limit: 3,
            windowMs: 60_000,
            now: new Date('2026-08-12T12:00:30.000Z'),
            db: adminDb
          })
        )
      )

      expect(results.filter(result => result.allowed)).toHaveLength(3)
    })
  })
})
