/**
 * Vibesboard Enterprise Edition — licensed under ../LICENSE, not MIT.
 *
 * Plan catalogue. The commercial equivalent of Chatwoot's
 * `enterprise/app/services/enterprise/billing/plan_configuration.rb`.
 *
 * PHASE 1 SCOPE: this file defines the *shape* only. Every tier currently
 * entitles ALL_FEATURES and lists a zero price, because the pricing model
 * (per-seat vs per-message vs hybrid) has not been decided yet. That is
 * deliberate — encoding a guessed tier split here would put a pricing decision
 * into code ahead of the business making it, and every call site would then be
 * built against fiction.
 *
 * PHASE 2 fills in: real prices, real per-tier `entitlements`, and the Stripe
 * price ids, then replaces `resolvePlanId` in enterprise-billing.ts with a
 * lookup of the tenant's actual subscription.
 */

import type { PlanId, SubscriptionEntitlements } from '@vibesboard/contracts'
import { ALL_FEATURES } from '@vibesboard/contracts'

export interface EnterprisePlan {
  readonly id: PlanId
  readonly name: string
  /** List price per billing period, in minor units (öre, cents). */
  readonly priceMinorUnits: number
  /** Additional price per seat per billing period, in minor units. */
  readonly pricePerSeatMinorUnits: number
  readonly currency: string
  readonly minSeats: number
  /** Messages included per billing period. `Infinity` when unmetered. */
  readonly includedMessages: number
  /** Charge per message beyond `includedMessages`, in minor units. */
  readonly overageRateMinorUnits: number
  /**
   * Feature-flag names this plan entitles a tenant to, or the ALL_FEATURES
   * sentinel. Reconciled into `tenant_feature_toggles` in Phase 2 so existing
   * `isFeatureEnabled()` call sites need no change.
   */
  readonly entitlements: readonly string[]
  /** Stripe price id. Null until Phase 2 wires Stripe. */
  readonly stripePriceId: string | null
}

const placeholder = (id: PlanId, name: string): EnterprisePlan => ({
  id,
  name,
  priceMinorUnits: 0,
  pricePerSeatMinorUnits: 0,
  currency: 'EUR',
  minSeats: 1,
  includedMessages: Number.POSITIVE_INFINITY,
  overageRateMinorUnits: 0,
  entitlements: [ALL_FEATURES],
  stripePriceId: null,
})

export const PLAN_CONFIGURATION: Record<PlanId, EnterprisePlan> = {
  free: placeholder('free', 'Free'),
  pro: placeholder('pro', 'Pro'),
  team: placeholder('team', 'Team'),
  enterprise: placeholder('enterprise', 'Enterprise'),
}

export const PLAN_IDS = Object.keys(PLAN_CONFIGURATION) as PlanId[]

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as string[]).includes(value)
}

export function toEntitlements(plan: EnterprisePlan): SubscriptionEntitlements {
  return {
    planId: plan.id,
    entitlements: plan.entitlements,
    includedMessages: plan.includedMessages,
  }
}
