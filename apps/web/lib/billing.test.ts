import { describe, expect, it, vi } from 'vitest'

import type { IBilling } from '@vibesboard/contracts'
import { communityBilling } from '@vibesboard/policy/billing'

import { getBilling } from './billing'

const fakeEnterprise: IBilling = {
  kind: 'enterprise',
  getEntitlements: async () => ({
    planId: 'enterprise',
    entitlements: ['CHATWOOT'],
    includedMessages: 100
  }),
  isEntitled: async (_tenantId, feature) => feature === 'CHATWOOT'
}

describe('getBilling', () => {
  it('returns the community implementation by default', async () => {
    await expect(getBilling({})).resolves.toBe(communityBilling)
  })

  it('never loads Enterprise Edition code in a community deployment', async () => {
    // The licence boundary depends on this: an MIT deployment must not reach
    // into ee/ at all, not even to look.
    const load = vi.fn()
    await getBilling({}, load)
    expect(load).not.toHaveBeenCalled()
  })

  it('selects the enterprise implementation when opted in', async () => {
    const billing = await getBilling(
      { VIBESBOARD_EDITION: 'enterprise' },
      async () => ({ enterpriseBilling: fakeEnterprise })
    )
    expect(billing).toBe(fakeEnterprise)
    expect(billing.kind).toBe('enterprise')
  })

  it('honours DISABLE_ENTERPRISE over the opt-in', async () => {
    const load = vi.fn()
    const billing = await getBilling(
      { VIBESBOARD_EDITION: 'enterprise', DISABLE_ENTERPRISE: 'true' },
      load
    )
    expect(billing).toBe(communityBilling)
    expect(load).not.toHaveBeenCalled()
  })

  it('falls back to community when the module resolves to the stub', async () => {
    // What a community distribution built after `rm -rf ee/` actually does:
    // the specifier resolves to lib/ee/billing-stub.ts, whose export is null.
    const billing = await getBilling(
      { VIBESBOARD_EDITION: 'enterprise' },
      async () => ({
        enterpriseBilling: null
      })
    )
    expect(billing).toBe(communityBilling)
  })

  it('falls back to community when the module cannot be loaded at all', async () => {
    const billing = await getBilling(
      { VIBESBOARD_EDITION: 'enterprise' },
      async () => {
        throw new Error('Cannot find module @vibesboard/ee-billing')
      }
    )
    expect(billing).toBe(communityBilling)
  })

  it('resolves the real stub through the configured alias', async () => {
    // Exercises the default loader, so a broken vitest/tsconfig alias fails
    // here rather than silently at build time.
    await expect(
      getBilling({ VIBESBOARD_EDITION: 'enterprise' })
    ).resolves.toBe(communityBilling)
  })
})
