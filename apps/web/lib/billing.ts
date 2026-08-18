// MIT (community core). Composition root for the IBilling port.
//
// The one place that decides which billing implementation a request sees. Two
// independent things have to line up before the enterprise one is used:
//
//   1. Runtime  — `VIBESBOARD_EDITION=enterprise`, and not overridden by
//      `DISABLE_ENTERPRISE=true`. See @vibesboard/policy/edition.
//   2. Build    — the `ee/` directory was present when the app was built, so
//      the bundler alias in next.config.mjs pointed `@vibesboard/ee-billing`
//      at real source rather than at lib/ee/billing-stub.ts.
//
// When either is false the community implementation is used. That ordering is
// what makes `rm -rf ee/ && bun run build` a supported configuration rather
// than a broken one.

import type { IBilling } from '@vibesboard/contracts'
import { communityBilling } from '@vibesboard/policy/billing'
import { isEnterprise, type EditionEnv } from '@vibesboard/policy/edition'

export type EnterpriseBillingModule = {
  enterpriseBilling?: IBilling | null
}

export type EnterpriseBillingLoader = () => Promise<EnterpriseBillingModule>

const loadEnterpriseBilling: EnterpriseBillingLoader = () =>
  import('@vibesboard/ee-billing')

/**
 * Resolve the billing implementation for this deployment.
 *
 * `env` and `load` are injectable so the selection logic is testable without
 * rebuilding the app — the same pattern the packages use for `db`.
 */
export async function getBilling(
  env: EditionEnv = process.env,
  load: EnterpriseBillingLoader = loadEnterpriseBilling
): Promise<IBilling> {
  if (!isEnterprise(env)) return communityBilling

  try {
    const mod = await load()
    // Chatwoot's `root.join('enterprise').exist?`, expressed in module terms:
    // the stub resolves to null, and a genuinely missing module throws.
    return mod.enterpriseBilling ?? communityBilling
  } catch {
    return communityBilling
  }
}
