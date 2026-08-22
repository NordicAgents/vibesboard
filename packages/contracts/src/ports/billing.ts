// IBilling — the seam between the MIT-licensed community core and the
// commercial Enterprise Edition. See /LICENSE and /ee/LICENSE.
//
// The community core ships `communityBilling` (@vibesboard/policy/billing):
// one notional plan, nothing metered, every feature entitled — identical to
// the behaviour the self-host shim in plans.ts has today. A deployment holding
// an Enterprise Edition licence swaps in an implementation that resolves the
// tenant's real subscription.
//
// Call sites depend on this interface only, never on the EE package, which is
// what lets the community build compile with the `ee/` directory deleted.

import type { PlanId } from '../domain-types.ts'

/**
 * Sentinel entitlement meaning "every feature". The community edition returns
 * it, so nothing in a self-hosted install is gated behind a subscription.
 */
export const ALL_FEATURES = '*'

export interface SubscriptionEntitlements {
  readonly planId: PlanId
  /**
   * Feature-flag names this subscription entitles the tenant to, or the
   * `ALL_FEATURES` sentinel. The EE billing package reconciles these into the
   * existing `tenant_feature_toggles` table, so every `isFeatureEnabled()`
   * call site keeps working unchanged.
   */
  readonly entitlements: readonly string[]
  /** Messages included per billing period. `Infinity` when unmetered. */
  readonly includedMessages: number
}

export interface IBilling {
  readonly kind: string
  /** What the tenant's current subscription entitles it to. */
  getEntitlements(tenantId: string): Promise<SubscriptionEntitlements>
  /** Whether the tenant's subscription entitles it to `feature`. */
  isEntitled(tenantId: string, feature: string): Promise<boolean>
}
