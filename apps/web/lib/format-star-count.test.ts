import { describe, it, expect } from 'vitest'

import { formatStarCount } from './format-star-count.ts'

describe('formatStarCount', () => {
  it('prints small counts verbatim — a rounded "0.1k" reads as a lie', () => {
    expect(formatStarCount(0)).toBe('0')
    expect(formatStarCount(7)).toBe('7')
    expect(formatStarCount(999)).toBe('999')
  })

  it('abbreviates thousands with one decimal, dropping a trailing zero', () => {
    expect(formatStarCount(1_000)).toBe('1k')
    expect(formatStarCount(1_234)).toBe('1.2k')
    expect(formatStarCount(9_949)).toBe('9.9k')
  })

  it('drops the decimal past ten thousand', () => {
    expect(formatStarCount(12_400)).toBe('12k')
    expect(formatStarCount(120_000)).toBe('120k')
  })

  it('never renders NaN or a negative badge', () => {
    expect(formatStarCount(Number.NaN)).toBe('0')
    expect(formatStarCount(-5)).toBe('0')
  })
})
