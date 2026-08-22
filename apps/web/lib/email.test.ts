import { describe, it, expect } from 'vitest'

import { maskEmail } from './email.ts'

describe('maskEmail', () => {
  it('masks a standard email', () => {
    expect(maskEmail('john@example.com')).toBe('j***@e***.com')
  })

  it('masks short local/domain parts', () => {
    expect(maskEmail('a@b.co')).toBe('a***@b***.co')
  })

  it('returns placeholder for invalid input', () => {
    expect(maskEmail('not-an-email')).toBe('***')
    expect(maskEmail('')).toBe('***')
    expect(maskEmail(null)).toBe('***')
    expect(maskEmail(undefined)).toBe('***')
  })
})
