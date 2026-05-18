# Strip Stripe + Simplify Policy — Design Spec

**Status:** Approved 2026-05-17 (sub-project #5 of self-host migration)
**Sub-project of:** Replace Firebase with self-hosted Postgres + S3 + Auth
**Predecessors:** #1 adapter-postgres ✅, #3 adapter-s3 ✅, #2 better-auth ✅
**Audience:** Engineer implementing with zero context for the codebase

---

## Context

Per the user's design directive at the start of this migration: **Stripe billing is always disabled in self-host.** That means `packages/billing`, `packages/adapter-stripe`, and all `app/api/stripe/*` routes are dead weight. This sub-project rips them out cleanly.

`packages/policy` has both load-bearing code (permissions, agent-links, feature flags) AND Stripe-coupled code (plans, plan-gated features, plan-limit usage enforcement). The Stripe-coupled half goes; the rest stays.

### Approved design decisions

1. **Pure deletion** — no flag-gated coexistence with Stripe in this codebase.
2. **Policy package survives, trimmed** — `packages/policy` keeps permissions/feature-flags/agent-links; deletes plans/features/usage.
3. **Shim for callers** — rather than rewrite ~30 files that import `PlanId` or `getPlanLimits()`, ship a pass-through shim that always returns the unlimited "self_hosted" answer. Each caller can be tidied incrementally in later work.
4. **Out of scope:** the Stripe types in `packages/contracts/src/firestore-types.ts` stay (sub-project #4 deletes that file).

---

## Goal

Delete every line of Stripe-specific code from the codebase; trim `packages/policy` to only its non-Stripe responsibilities; keep every existing caller of `@vibesboard/policy` compiling via a shim that always returns "allowed".

### Non-goals

- No deletion of `packages/adapter-firebase` (sub-project #4).
- No deletion of Stripe-typed entities from `packages/contracts/src/firestore-types.ts` (sub-project #4).
- No Cloud Scheduler / deploy-script changes (sub-project #6).

---

## Architecture

### What gets deleted

```
packages/billing/                                       DELETE entire package
packages/adapter-stripe/                                DELETE entire package
apps/web/app/api/stripe/                                DELETE entire dir (4 routes)
apps/web/app/api/cron/billing-reset/                    DELETE
apps/web/app/api/admin/plans/                           DELETE entire dir (3 routes)
apps/web/app/api/admin/tenants/[id]/stripe-sync/        DELETE
apps/web/app/api/admin/tenants/[id]/subscription/       DELETE
apps/web/app/api/tenants/[id]/billing/                  DELETE
apps/web/app/pricing/                                   DELETE (page + any related routes)
apps/web/app/settings/tenant/billing/                   DELETE (page)
apps/web/app/admin/tenants/[id]/tabs/subscription-tab.tsx  DELETE (move admin tab grid to skip it)
scripts/stripe-setup.ts                                  DELETE
packages/policy/src/plans.ts                             REPLACE with shim
packages/policy/src/features.ts                          REPLACE with shim
packages/policy/src/usage.ts                             REPLACE with shim (no-op tracker)
packages/policy/src/usage-core.ts                        REPLACE with shim
packages/policy/src/usage.test.ts                        DELETE
packages/policy/src/usage-types.test.ts                  DELETE
```

### What gets kept in `packages/policy`

```
packages/policy/src/
  index.ts                       (modified — drop removed exports)
  permissions.ts                 KEEP (RBAC core)
  permissions-core.ts            KEEP
  permissions.test.ts            KEEP
  feature-flags.ts               KEEP (read-only feature flag access)
  agent-links/                   KEEP (DB-backed agent link helpers)
  plans.ts                       SHIM (always 'self_hosted')
  features.ts                    SHIM (every feature returns enabled)
  usage.ts                       SHIM (no-op logUsage, getUsage)
  usage-core.ts                  SHIM (returns Infinity for limits)
```

### What the shim looks like

```ts
// packages/policy/src/plans.ts (shim — keeps existing imports compiling)

/** Self-host has a single notional plan. */
export type PlanId = 'self_hosted'

export interface PlanLimits {
  messages: number       // Infinity in self-host
  agents: number         // Infinity
  members: number        // Infinity
}

export const DEFAULT_PLANS: Record<PlanId, PlanLimits> = {
  self_hosted: { messages: Infinity, agents: Infinity, members: Infinity },
}

export function getPlanLimits(_planId: PlanId | string | null | undefined): PlanLimits {
  return DEFAULT_PLANS.self_hosted
}

export function getDefaultPlanId(): PlanId {
  return 'self_hosted'
}
```

```ts
// packages/policy/src/features.ts (shim)

/** Every feature is unlocked in self-host. */
export function hasFeature(_tenantPlanId: string | null | undefined, _featureKey: string): boolean {
  return true
}

export function tenantHasFeature(_tenant: unknown, _featureKey: string): boolean {
  return true
}
```

```ts
// packages/policy/src/usage.ts (shim)

export type UsageSource = string  // Permissive — callers pass enum values

export async function logUsage(_args: unknown): Promise<void> {
  // no-op: self-host doesn't track usage centrally
}

export async function getUsage(_args: unknown): Promise<{ messages: number; limit: number }> {
  return { messages: 0, limit: Infinity }
}

export async function checkLimit(_args: unknown): Promise<{ allowed: true; remaining: number }> {
  return { allowed: true, remaining: Infinity }
}
```

```ts
// packages/policy/src/usage-core.ts (shim)
// Re-export everything usage.ts needs internally; same passthrough pattern.
export { logUsage, getUsage, checkLimit, type UsageSource } from './usage.ts'
```

Existing callers like `policy/usage.logUsage({ tenantId, agentId, ... })` continue compiling and run the no-op. We lose runtime usage data, which is acceptable — self-host operators who want metering can re-add it locally.

### Routes/pages with non-trivial callers

These files are deleted but have inbound links from the UI:

- `apps/web/app/pricing/page.tsx` — referenced from `apps/web/middleware.ts:RESERVED_SLUGS` and likely some header nav. Middleware reserved slug stays (cosmetic — same path name now 404s instead of resolving as a tenant). Nav links get removed.
- `apps/web/app/settings/tenant/billing/page.tsx` — referenced from the settings sidebar. Remove the link.
- `apps/web/app/admin/tenants/[id]/tabs/subscription-tab.tsx` — referenced from the admin tenant detail page's tab list. Remove the tab.

### Env vars removed from `.env.example`

```
STRIPE_SECRET_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_PRO_BASE
STRIPE_PRICE_PRO_OVERAGE
STRIPE_PRICE_TEAM_BASE
STRIPE_PRICE_TEAM_OVERAGE
```

`CRON_SECRET` stays (Cron Scheduler invokes other endpoints too; only billing-reset goes away).

---

## Deliverables

### Deleted

```
packages/billing/
packages/adapter-stripe/
apps/web/app/api/stripe/
apps/web/app/api/cron/billing-reset/
apps/web/app/api/admin/plans/
apps/web/app/api/admin/tenants/[id]/stripe-sync/
apps/web/app/api/admin/tenants/[id]/subscription/
apps/web/app/api/tenants/[id]/billing/
apps/web/app/pricing/
apps/web/app/settings/tenant/billing/
apps/web/app/admin/tenants/[id]/tabs/subscription-tab.tsx
scripts/stripe-setup.ts
packages/policy/src/usage.test.ts
packages/policy/src/usage-types.test.ts
```

### Modified

```
packages/policy/src/plans.ts          (replaced with shim)
packages/policy/src/features.ts        (replaced with shim)
packages/policy/src/usage.ts           (replaced with shim)
packages/policy/src/usage-core.ts      (replaced with shim)
packages/policy/src/index.ts           (drop deleted exports if any)
apps/web/package.json                  (drop @vibesboard/billing, @vibesboard/adapter-stripe deps)
.env.example                           (drop STRIPE_* block)
apps/web/app/admin/tenants/[id]/page.tsx          (or wherever the tab list lives — remove subscription tab)
apps/web/app/settings/layout.tsx       (remove billing nav link if present)
apps/web/components/<any header nav>   (remove "Pricing" link if present)
README.md                              (drop any pricing/billing mentions)
```

### Untouched

- `packages/contracts/src/firestore-types.ts` Stripe interfaces (sub-project #4 deletes them)
- `apps/web/lib/firebase/admin.ts` and any GCS-using code (sub-project #4)
- `deploy-cloud-run.sh` Stripe sections (sub-project #6)
- `DEPLOY.md` Stripe sections (sub-project #6)

---

## Success criteria

1. ✅ `pnpm install` resolves; no unresolved workspace dep.
2. ✅ `pnpm type-check` passes — no caller of `policy` is broken by the shim.
3. ✅ `pnpm lint`, `pnpm format:check` pass.
4. ✅ `pnpm --filter @vibesboard/web build` succeeds.
5. ✅ `pnpm --filter @vibesboard/adapter-postgres test` 23/23.
6. ✅ `pnpm --filter @vibesboard/adapter-better-auth test` 7/7.
7. ✅ `pnpm --filter @vibesboard/adapter-s3 test` 1/1.
8. ✅ `pnpm --filter @vibesboard/policy test` passes (only permissions.test.ts remains).
9. ✅ `grep -rEn "STRIPE_|stripe\\.|@vibesboard/(billing|adapter-stripe)" apps/ packages/ --include='*.ts' --include='*.tsx' --include='*.json'` returns zero matches outside `packages/contracts/src/firestore-types.ts` (intentionally untouched).
10. ✅ `ls packages/billing packages/adapter-stripe apps/web/app/api/stripe apps/web/app/api/admin/plans apps/web/app/pricing 2>&1` reports "No such file or directory" for each.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| A caller relied on a precise plan-limits value (e.g. `getPlanLimits().messages === 5000`) | Self-host has no notion of paid plans; treating everything as `Infinity` is the correct behaviour. If anything depends on a finite limit, it should be removed (or rewritten to use a local env var). |
| Removing the "Pricing" nav link breaks an existing route | Verify with `grep -r "/pricing" apps/web` after deletion; remove any dangling links. |
| Stripe types in `firestore-types.ts` still referenced by deleted code | Once we delete the callers, the types become unreachable from app code but stay defined. Sub-project #4 removes them. |
| `usage_counters` table in Postgres now has no writers | That's fine — it stays as a no-op table; sub-project #4 may rip it or leave for future use. |
