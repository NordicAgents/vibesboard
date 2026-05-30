import { describe, it, expect } from 'vitest'
import {
  coerceTokenCount,
  buildRollupUpdateFields,
  buildRollupSetFields,
} from './usage-core.ts'

describe('usage-core: coerceTokenCount', () => {
  it('passes through finite non-negative integers', () => {
    expect(coerceTokenCount(0)).toBe(0)
    expect(coerceTokenCount(42)).toBe(42)
    expect(coerceTokenCount(1_000_000)).toBe(1_000_000)
  })

  it('passes through finite non-negative floats unchanged', () => {
    // The implementation only guards finiteness + non-negativity, not integer-ness.
    expect(coerceTokenCount(3.5)).toBe(3.5)
  })

  it('coerces negatives to 0', () => {
    expect(coerceTokenCount(-1)).toBe(0)
    expect(coerceTokenCount(-9999)).toBe(0)
  })

  it('coerces non-finite numbers to 0', () => {
    expect(coerceTokenCount(Number.NaN)).toBe(0)
    expect(coerceTokenCount(Number.POSITIVE_INFINITY)).toBe(0)
    expect(coerceTokenCount(Number.NEGATIVE_INFINITY)).toBe(0)
  })

  it('coerces non-number inputs to 0', () => {
    expect(coerceTokenCount(undefined)).toBe(0)
    expect(coerceTokenCount(null)).toBe(0)
    expect(coerceTokenCount('5')).toBe(0)
    expect(coerceTokenCount({})).toBe(0)
    expect(coerceTokenCount([])).toBe(0)
  })
})

describe('usage-core: rollup field builders (self-host no-ops)', () => {
  it('buildRollupUpdateFields returns an empty object regardless of input', () => {
    expect(buildRollupUpdateFields(undefined)).toEqual({})
    expect(buildRollupUpdateFields({ inputTokens: 5, outputTokens: 9 })).toEqual({})
  })

  it('buildRollupSetFields returns an empty object regardless of input', () => {
    expect(buildRollupSetFields(undefined)).toEqual({})
    expect(buildRollupSetFields({ messages: 3 })).toEqual({})
  })
})
