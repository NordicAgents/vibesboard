import { describe, expect, it } from 'vitest'

import { ALL_FEATURES } from '@vibesboard/contracts'

import { communityBilling, isEntitledTo } from './billing.ts'

describe('communityBilling', () => {
  it('identifies itself as the community implementation', () => {
    expect(communityBilling.kind).toBe('community')
  })

  it('entitles a tenant to every feature', async () => {
    const subscription = await communityBilling.getEntitlements('tenant-1')
    expect(subscription.entitlements).toContain(ALL_FEATURES)
    expect(await communityBilling.isEntitled('tenant-1', 'BYO_LLM')).toBe(true)
    expect(await communityBilling.isEntitled('tenant-1', 'anything')).toBe(true)
  })

  it('meters nothing', async () => {
    const subscription = await communityBilling.getEntitlements('tenant-1')
    expect(subscription.includedMessages).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('isEntitledTo', () => {
  const base = { planId: 'free', includedMessages: 0 } as const

  it('treats the ALL_FEATURES sentinel as entitling everything', () => {
    const subscription = { ...base, entitlements: [ALL_FEATURES] }
    expect(isEntitledTo(subscription, 'CHATWOOT')).toBe(true)
    expect(isEntitledTo(subscription, 'SOMETHING_NEW')).toBe(true)
  })

  it('matches named entitlements exactly', () => {
    const subscription = { ...base, entitlements: ['CHATWOOT', 'INBOX'] }
    expect(isEntitledTo(subscription, 'CHATWOOT')).toBe(true)
    expect(isEntitledTo(subscription, 'BYO_LLM')).toBe(false)
  })

  it('entitles nothing when the list is empty', () => {
    expect(isEntitledTo({ ...base, entitlements: [] }, 'CHATWOOT')).toBe(false)
  })
})
