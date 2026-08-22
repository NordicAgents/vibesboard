/**
 * Vibesboard Enterprise Edition — licensed under ../LICENSE, not MIT.
 *
 * The enterprise implementation of the IBilling port. Resolved at runtime by
 * apps/web/lib/billing.ts when `VIBESBOARD_EDITION=enterprise`; the MIT core
 * never imports this module directly.
 */

import type { IBilling, PlanId, SubscriptionEntitlements } from '@vibesboard/contracts'
import { isEntitledTo } from '@vibesboard/policy/billing'

import { PLAN_CONFIGURATION, isPlanId, toEntitlements } from './plan-configuration.ts'

export interface ResolvePlanEnv {
  VIBESBOARD_DEFAULT_PLAN?: string | undefined
  // See the note on EditionEnv: an index signature keeps `process.env`
  // assignable to an otherwise all-optional interface.
  [key: string]: string | undefined
}

/**
 * Which plan a tenant is on.
 *
 * PHASE 1: there is no subscription store yet, so every tenant resolves to the
 * plan named by `VIBESBOARD_DEFAULT_PLAN`, defaulting to `enterprise` (which
 * entitles everything). This matters: switching a working deployment to
 * `VIBESBOARD_EDITION=enterprise` must not silently take features away from
 * tenants that already had them.
 *
 * PHASE 2: replace the body with a lookup of the tenant's Stripe subscription,
 * falling back to `free` when none exists.
 */
export async function resolvePlanId(
  _tenantId: string,
  env: ResolvePlanEnv = process.env
): Promise<PlanId> {
  const configured = env.VIBESBOARD_DEFAULT_PLAN
  return isPlanId(configured) ? configured : 'enterprise'
}

export async function getEntitlements(
  tenantId: string,
  env?: ResolvePlanEnv
): Promise<SubscriptionEntitlements> {
  return toEntitlements(PLAN_CONFIGURATION[await resolvePlanId(tenantId, env)])
}

export const enterpriseBilling: IBilling = {
  kind: 'enterprise',

  getEntitlements(tenantId: string): Promise<SubscriptionEntitlements> {
    return getEntitlements(tenantId)
  },

  async isEntitled(tenantId: string, feature: string): Promise<boolean> {
    return isEntitledTo(await getEntitlements(tenantId), feature)
  },
}
