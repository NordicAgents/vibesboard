/**
 * The community (MIT) implementation of the IBilling port.
 *
 * Behaviour is identical to the self-host shim in plans.ts: one notional plan,
 * nothing metered, every feature entitled. Self-hosting must never be degraded
 * by the existence of a commercial edition, so this is what a default install
 * gets and what every test asserts against.
 *
 * The Enterprise Edition implementation lives in `ee/billing` under a separate
 * licence (see /ee/LICENSE) and is resolved at runtime by
 * apps/web/lib/billing.ts.
 */

import type { IBilling, SubscriptionEntitlements } from '@vibesboard/contracts'
import { ALL_FEATURES } from '@vibesboard/contracts'

import { getDefaultPlanId } from './plans.ts'

/**
 * Does a subscription entitle the tenant to `feature`?
 *
 * Pure so both editions share one definition of the sentinel's meaning — an EE
 * implementation that reimplemented this could silently diverge.
 */
export function isEntitledTo(
  subscription: SubscriptionEntitlements,
  feature: string
): boolean {
  return (
    subscription.entitlements.includes(ALL_FEATURES) ||
    subscription.entitlements.includes(feature)
  )
}

export const communityBilling: IBilling = {
  kind: 'community',

  async getEntitlements(_tenantId: string): Promise<SubscriptionEntitlements> {
    return {
      planId: getDefaultPlanId(),
      entitlements: [ALL_FEATURES],
      includedMessages: Number.POSITIVE_INFINITY,
    }
  },

  async isEntitled(_tenantId: string, _feature: string): Promise<boolean> {
    return true
  },
}
