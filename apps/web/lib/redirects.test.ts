import { describe, it, expect } from 'vitest'

import { getSafeRedirectPath } from './redirects.ts'

describe('getSafeRedirectPath', () => {
  it('allows relative paths', () => {
    expect(getSafeRedirectPath('/invite/abc')).toBe('/invite/abc')
    expect(getSafeRedirectPath('/agents/new?x=1')).toBe('/agents/new?x=1')
  })

  it('rejects unsafe or absolute targets', () => {
    expect(getSafeRedirectPath(null)).toBe(null)
    expect(getSafeRedirectPath('')).toBe(null)
    expect(getSafeRedirectPath('   ')).toBe(null)
    expect(getSafeRedirectPath('http://evil.com')).toBe(null)
    expect(getSafeRedirectPath('https://evil.com')).toBe(null)
    expect(getSafeRedirectPath('//evil.com')).toBe(null)
    expect(getSafeRedirectPath('javascript:alert(1)')).toBe(null)
    expect(getSafeRedirectPath('/path\nnext')).toBe(null)
    expect(getSafeRedirectPath('/path\rnext')).toBe(null)
    expect(getSafeRedirectPath('/\\\\evil.com')).toBe(null)
  })
})
