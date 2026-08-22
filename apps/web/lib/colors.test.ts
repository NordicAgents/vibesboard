import { describe, it, expect } from 'vitest'

import {
  hexToHslParts,
  hexToRgbParts,
  normalizeHex,
  toCssHslVar
} from './colors.ts'

describe('colors', () => {
  it('normalizeHex', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc')
    expect(normalizeHex('ABC')).toBe('#aabbcc')
    expect(normalizeHex('#AABBCC')).toBe('#aabbcc')
    expect(normalizeHex('')).toBe(null)
    expect(normalizeHex('not-a-color')).toBe(null)
    expect(normalizeHex('#abcd')).toBe(null)
  })

  it('hexToHslParts', () => {
    expect(hexToHslParts('#000000')).toEqual({ h: 0, s: 0, l: 0 })
    expect(hexToHslParts('#ffffff')).toEqual({ h: 0, s: 0, l: 100 })
    expect(hexToHslParts('#ff0000')).toEqual({ h: 0, s: 100, l: 50 })
  })

  it('hexToRgbParts', () => {
    expect(hexToRgbParts('#0f10f0')).toEqual({ r: 15, g: 16, b: 240 })
  })

  it('toCssHslVar', () => {
    expect(toCssHslVar({ h: 0, s: 100, l: 50 })).toBe('0 100% 50%')
    expect(toCssHslVar({ h: 240, s: 5.9, l: 10 })).toBe('240 5.9% 10%')
  })
})
