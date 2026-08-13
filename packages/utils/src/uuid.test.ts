import { describe, expect, it } from 'vitest'
import { isUuid } from './uuid.ts'

describe('isUuid', () => {
  it('accepts canonical UUIDs case-insensitively', () => {
    expect(isUuid('018f6c62-7f8a-7c22-8bd4-8f4dd3f1d0b1')).toBe(true)
    expect(isUuid('018F6C62-7F8A-7C22-8BD4-8F4DD3F1D0B1')).toBe(true)
  })

  it('rejects malformed database identifiers', () => {
    expect(isUuid('agent-1')).toBe(false)
    expect(isUuid('undefined')).toBe(false)
    expect(isUuid('')).toBe(false)
  })
})
