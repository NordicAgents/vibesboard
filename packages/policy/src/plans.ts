/**
 * Self-host shim — Stripe is removed; there is one notional plan with
 * no enforced limits. Callers of the previous plan API continue to
 * compile via this module's exports; runtime behaviour is "always allowed".
 */

// Re-export PlanId so callers that imported it from '@/lib/plans' keep
// working through the apps/web shim. Canonical definition is in
// @vibesboard/contracts.
export type { PlanId } from '@vibesboard/contracts'

import type { PlanId } from '@vibesboard/contracts'
import type { FeatureFlagName } from './feature-flags.ts'

export interface PlanDefinition {
  id: PlanId
  name: string
  price: number
  pricePerSeat?: number
  minSeats?: number
  includedMessages: number
  includedMessagesPerSeat?: number
  overageRate: number
  featureFlags: FeatureFlagName[]
}

// PlanLimits alias kept for any caller that used the old shape
export interface PlanLimits {
  messages: number
  agents: number
  members: number
}

// PlanTemplate alias kept for any caller that used the old shape
export type PlanTemplate = PlanDefinition

export const DEFAULT_PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    includedMessages: Number.POSITIVE_INFINITY,
    overageRate: 0,
    featureFlags: [],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 0,
    includedMessages: Number.POSITIVE_INFINITY,
    overageRate: 0,
    featureFlags: [],
  },
  team: {
    id: 'team',
    name: 'Team',
    price: 0,
    includedMessages: Number.POSITIVE_INFINITY,
    overageRate: 0,
    featureFlags: [],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 0,
    includedMessages: Number.POSITIVE_INFINITY,
    overageRate: 0,
    featureFlags: [],
  },
}

// PLAN_TEMPLATES kept as an alias for DEFAULT_PLANS for backward compatibility
export const PLAN_TEMPLATES = DEFAULT_PLANS

/** toPlanDefinition — identity shim; source document shape no longer matters */
export function toPlanDefinition(doc: { id?: unknown; name?: unknown; price?: unknown; pricePerSeat?: unknown; minSeats?: unknown; includedMessagesPerSeat?: unknown; [key: string]: unknown }): PlanDefinition {
  return {
    id: (doc.id as PlanId) ?? 'free',
    name: (doc.name as string) ?? 'Self-host',
    price: (doc.price as number) ?? 0,
    pricePerSeat: doc.pricePerSeat as number | undefined,
    minSeats: doc.minSeats as number | undefined,
    includedMessages: Number.POSITIVE_INFINITY,
    includedMessagesPerSeat: doc.includedMessagesPerSeat as number | undefined,
    overageRate: 0,
    featureFlags: [],
  }
}

/** Always returns the default (unlimited) plan for any planId. */
export async function getPlanTemplate(
  _planId: PlanId | string | null | undefined,
): Promise<PlanDefinition> {
  return DEFAULT_PLANS.free
}

/** Returns all plans (all pointing to unlimited self-host config). */
export async function getAllPlanTemplates(): Promise<PlanDefinition[]> {
  return Object.values(DEFAULT_PLANS)
}

/** No-op: there is no cache to invalidate. */
export function invalidatePlanCache(_planId?: PlanId): void {}

/** Compute the effective message limit — always infinite in self-host. */
export function computeMessageLimit(
  _plan: PlanDefinition,
  _seatCount: number,
): number {
  return Number.POSITIVE_INFINITY
}

export function getPlanLimits(_planId: PlanId | string | null | undefined): PlanLimits {
  return {
    messages: Number.POSITIVE_INFINITY,
    agents: Number.POSITIVE_INFINITY,
    members: Number.POSITIVE_INFINITY,
  }
}

export function getDefaultPlanId(): PlanId {
  return 'free'
}
