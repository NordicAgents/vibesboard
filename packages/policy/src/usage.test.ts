import { describe, it, expect } from 'vitest'
import {
  recordUsage,
  checkUsageLimit,
  logUsage,
  getUsage,
  checkLimit,
  getUsageRollup,
} from './usage.ts'

// usage.ts is the self-host shim: recording is a no-op and every limit check
// reports unlimited/allowed. These tests pin that contract.
describe('usage: self-host shim contract', () => {
  it('recordUsage is a no-op that returns undefined and does not throw', () => {
    expect(
      recordUsage({
        tenantId: 't1',
        agentId: 'a1',
        conversationId: null,
        userId: null,
        source: 'web' as any,
        model: 'gpt-5-nano',
      }),
    ).toBe(undefined)
  })

  it('checkUsageLimit always allows with infinite remaining', async () => {
    const res = await checkUsageLimit('t1')
    expect(res.allowed).toBe(true)
    expect(res.remaining).toBe(Number.POSITIVE_INFINITY)
    expect(res.limit).toBe(Number.POSITIVE_INFINITY)
    expect(res.used).toBe(0)
    expect(res.planId).toBe('free')
  })

  it('logUsage resolves to undefined', async () => {
    expect(await logUsage({})).toBe(undefined)
  })

  it('getUsage reports zero messages against an infinite limit', async () => {
    expect(await getUsage({})).toEqual({
      messages: 0,
      limit: Number.POSITIVE_INFINITY,
    })
  })

  it('checkLimit always allows with infinite remaining', async () => {
    expect(await checkLimit({})).toEqual({
      allowed: true,
      remaining: Number.POSITIVE_INFINITY,
    })
  })

  it('getUsageRollup reports all-zero totals', async () => {
    expect(await getUsageRollup({})).toEqual({
      totalMessages: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    })
  })
})
