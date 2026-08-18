import { describe, expect, it } from 'vitest'

import { isEnterprise, resolveEdition } from './edition.ts'

describe('resolveEdition', () => {
  it('defaults to community when nothing is set', () => {
    expect(resolveEdition({})).toBe('community')
    expect(isEnterprise({})).toBe(false)
  })

  it('returns enterprise only for the exact opt-in value', () => {
    expect(resolveEdition({ VIBESBOARD_EDITION: 'enterprise' })).toBe(
      'enterprise'
    )
    expect(isEnterprise({ VIBESBOARD_EDITION: 'enterprise' })).toBe(true)
  })

  it('does not accept near-miss values as an opt-in', () => {
    // Guards against a deployment believing it enabled EE via a typo and
    // silently running the community path (or worse, the reverse).
    for (const value of ['Enterprise', 'ENTERPRISE', 'ee', 'true', '1', '']) {
      expect(resolveEdition({ VIBESBOARD_EDITION: value })).toBe('community')
    }
  })

  it('lets DISABLE_ENTERPRISE override the opt-in', () => {
    expect(
      resolveEdition({
        VIBESBOARD_EDITION: 'enterprise',
        DISABLE_ENTERPRISE: 'true',
      })
    ).toBe('community')
  })

  it('only treats the literal string "true" as disabling', () => {
    // A bare `DISABLE_ENTERPRISE=` (empty) must not disable an intentional
    // enterprise deployment.
    expect(
      resolveEdition({
        VIBESBOARD_EDITION: 'enterprise',
        DISABLE_ENTERPRISE: '',
      })
    ).toBe('enterprise')
    expect(
      resolveEdition({
        VIBESBOARD_EDITION: 'enterprise',
        DISABLE_ENTERPRISE: 'false',
      })
    ).toBe('enterprise')
  })
})
