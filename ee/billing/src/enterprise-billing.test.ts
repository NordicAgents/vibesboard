import { describe, expect, it } from 'vitest'

import { ALL_FEATURES } from '@vibesboard/contracts'

import {
  enterpriseBilling,
  getEntitlements,
  resolvePlanId,
} from './enterprise-billing.ts'
import { PLAN_CONFIGURATION, isPlanId, toEntitlements } from './plan-configuration.ts'

describe('enterpriseBilling', () => {
  it('identifies itself distinctly from the community implementation', () => {
    // apps/web/lib/billing.test.ts asserts on this to prove the edition gate
    // actually selects a different object.
    expect(enterpriseBilling.kind).toBe('enterprise')
  })

  it('does not take features away from a deployment that switches to enterprise', async () => {
    // The safety property: turning VIBESBOARD_EDITION on must not downgrade
    // tenants that already worked. Phase 2 replaces resolvePlanId with a real
    // subscription lookup and this test must be revisited alongside it.
    const subscription = await enterpriseBilling.getEntitlements('tenant-1')
    expect(subscription.entitlements).toContain(ALL_FEATURES)
    expect(await enterpriseBilling.isEntitled('tenant-1', 'BYO_LLM')).toBe(true)
  })
})

describe('resolvePlanId', () => {
  it('defaults to enterprise when nothing is configured', async () => {
    await expect(resolvePlanId('tenant-1', {})).resolves.toBe('enterprise')
  })

  it('honours a configured default plan', async () => {
    await expect(
      resolvePlanId('tenant-1', { VIBESBOARD_DEFAULT_PLAN: 'team' })
    ).resolves.toBe('team')
  })

  it('ignores an unrecognised plan rather than crashing', async () => {
    // A typo in deployment config must not produce `PLAN_CONFIGURATION[undefined]`.
    await expect(
      resolvePlanId('tenant-1', { VIBESBOARD_DEFAULT_PLAN: 'platinum' })
    ).resolves.toBe('enterprise')
  })
})

describe('plan configuration', () => {
  it('exposes every PlanId', () => {
    expect(Object.keys(PLAN_CONFIGURATION).sort()).toEqual([
      'enterprise',
      'free',
      'pro',
      'team',
    ])
  })

  it('keeps each entry self-consistent', () => {
    for (const [key, plan] of Object.entries(PLAN_CONFIGURATION)) {
      expect(plan.id).toBe(key)
      expect(plan.minSeats).toBeGreaterThanOrEqual(1)
      expect(toEntitlements(plan).planId).toBe(plan.id)
    }
  })

  it('guards plan ids', () => {
    expect(isPlanId('pro')).toBe(true)
    expect(isPlanId('platinum')).toBe(false)
    expect(isPlanId(undefined)).toBe(false)
    expect(isPlanId(7)).toBe(false)
  })

  it('resolves a subscription for every configured plan', async () => {
    for (const id of Object.keys(PLAN_CONFIGURATION)) {
      const subscription = await getEntitlements('tenant-1', {
        VIBESBOARD_DEFAULT_PLAN: id,
      })
      expect(subscription.planId).toBe(id)
    }
  })
})
