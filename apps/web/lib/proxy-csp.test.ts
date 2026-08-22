import { describe, expect, it } from 'vitest'

import { buildContentSecurityPolicy } from '../proxy.ts'

describe('Content Security Policy', () => {
  it('nonce-binds scripts and blocks executable plugin content', () => {
    const policy = buildContentSecurityPolicy('test-nonce', {
      widget: false,
      development: false
    })

    expect(policy).toContain(
      "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'"
    )
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("frame-ancestors 'self'")
    expect(policy).not.toContain("'unsafe-eval'")
  })

  it('permits customer framing only for the widget policy', () => {
    const policy = buildContentSecurityPolicy('test-nonce', {
      widget: true,
      development: true
    })

    expect(policy).toContain('frame-ancestors *')
    expect(policy).toContain("'unsafe-eval'")
    expect(policy).not.toContain('upgrade-insecure-requests')
  })
})
