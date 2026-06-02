import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PLANS,
  PLAN_TEMPLATES,
  toPlanDefinition,
  getPlanTemplate,
  getAllPlanTemplates,
  invalidatePlanCache,
  computeMessageLimit,
  getPlanLimits,
  getDefaultPlanId,
} from './plans.ts'

describe('plans: DEFAULT_PLANS shape', () => {
  it('defines the four canonical plan ids keyed by their own id', () => {
    expect(Object.keys(DEFAULT_PLANS).sort()).toEqual(
      ['enterprise', 'free', 'pro', 'team'].sort(),
    )
    for (const [key, def] of Object.entries(DEFAULT_PLANS)) {
      expect(def.id).toBe(key)
    }
  })

  it('every plan is unlimited (infinite messages, zero price/overage) in self-host', () => {
    for (const def of Object.values(DEFAULT_PLANS)) {
      expect(def.includedMessages).toBe(Number.POSITIVE_INFINITY)
      expect(def.price).toBe(0)
      expect(def.overageRate).toBe(0)
      expect(def.featureFlags).toEqual([])
    }
  })

  it('PLAN_TEMPLATES is an alias for DEFAULT_PLANS', () => {
    expect(PLAN_TEMPLATES).toBe(DEFAULT_PLANS)
  })
})

describe('plans: toPlanDefinition (identity shim)', () => {
  it('forces unlimited messages and zero overage regardless of input', () => {
    const def = toPlanDefinition({
      id: 'pro',
      name: 'Custom Pro',
      price: 99,
      overageRate: 5,
    })
    expect(def.id).toBe('pro')
    expect(def.name).toBe('Custom Pro')
    expect(def.price).toBe(99) // price is passed through...
    expect(def.includedMessages).toBe(Number.POSITIVE_INFINITY) // ...but messages are forced
    expect(def.overageRate).toBe(0)
    expect(def.featureFlags).toEqual([])
  })

  it('applies free/Self-host defaults when id and name are missing', () => {
    const def = toPlanDefinition({})
    expect(def.id).toBe('free')
    expect(def.name).toBe('Self-host')
    expect(def.price).toBe(0)
  })

  it('carries optional seat fields through', () => {
    const def = toPlanDefinition({ pricePerSeat: 10, minSeats: 3, includedMessagesPerSeat: 100 })
    expect(def.pricePerSeat).toBe(10)
    expect(def.minSeats).toBe(3)
    expect(def.includedMessagesPerSeat).toBe(100)
  })
})

describe('plans: async accessors', () => {
  it('getPlanTemplate always returns the free (unlimited) plan', async () => {
    expect(await getPlanTemplate('enterprise')).toBe(DEFAULT_PLANS.free)
    expect(await getPlanTemplate(null)).toBe(DEFAULT_PLANS.free)
    expect(await getPlanTemplate(undefined)).toBe(DEFAULT_PLANS.free)
  })

  it('getAllPlanTemplates returns every default plan', async () => {
    const all = await getAllPlanTemplates()
    expect(all.length).toBe(Object.keys(DEFAULT_PLANS).length)
    expect(all).toEqual(Object.values(DEFAULT_PLANS))
  })
})

describe('plans: limit helpers (always unlimited)', () => {
  it('computeMessageLimit is infinite for any plan/seat count', () => {
    expect(computeMessageLimit(DEFAULT_PLANS.free, 1)).toBe(Number.POSITIVE_INFINITY)
    expect(computeMessageLimit(DEFAULT_PLANS.enterprise, 1000)).toBe(
      Number.POSITIVE_INFINITY,
    )
  })

  it('getPlanLimits returns infinite messages/agents/members for any id', () => {
    expect(getPlanLimits('free')).toEqual({
      messages: Number.POSITIVE_INFINITY,
      agents: Number.POSITIVE_INFINITY,
      members: Number.POSITIVE_INFINITY,
    })
    expect(getPlanLimits(null)).toEqual(getPlanLimits('anything'))
  })

  it('getDefaultPlanId is free', () => {
    expect(getDefaultPlanId()).toBe('free')
  })

  it('invalidatePlanCache is a no-op that does not throw', () => {
    expect(() => invalidatePlanCache()).not.toThrow()
    expect(() => invalidatePlanCache('pro')).not.toThrow()
    expect(invalidatePlanCache('pro')).toBe(undefined)
  })
})
