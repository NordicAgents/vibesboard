/**
 * Vibesboard Enterprise Edition — licensed under ../LICENSE, not MIT.
 *
 * @vibesboard/ee-billing — the enterprise IBilling implementation.
 *
 * apps/web/lib/billing.ts is the only consumer. It reaches this module through
 * a bundler alias so that deleting the whole `ee/` directory still produces a
 * working community build.
 */

export { enterpriseBilling, getEntitlements, resolvePlanId } from './enterprise-billing.ts'
export {
  PLAN_CONFIGURATION,
  PLAN_IDS,
  isPlanId,
  toEntitlements,
  type EnterprisePlan,
} from './plan-configuration.ts'
