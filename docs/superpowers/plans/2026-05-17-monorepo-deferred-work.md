# Monorepo Split — Deferred Work

**Branch:** `feature/monorepo-split`
**Status as of:** 2026-05-17
**Companion docs:**
- [2026-05-16-monorepo-split-design.md](../specs/2026-05-16-monorepo-split-design.md) — original 12-phase spec
- [2026-05-17-monorepo-split-implementation.md](2026-05-17-monorepo-split-implementation.md) — implementation plan for phases 0-2
- [2026-05-17-monorepo-phase-6-sub-plan.md](2026-05-17-monorepo-phase-6-sub-plan.md) — Phase 6 sub-plan (topological extraction with bundled cycles)

This document captures **what was deliberately not done** in the migration, why, and what it would take to do later.

---

## 1. What shipped

18 commits on `feature/monorepo-split`. 19 packages under `packages/`. Every commit independently passes:

- `pnpm -r type-check` (all packages + apps/web)
- `pnpm --filter @vibesboard/web test`
- `pnpm --filter @vibesboard/web build`
- `cd apps/functions && npm run build`
- Live smoke against the running Firebase emulator suite (all 17 representative routes correct — 200 for public, 401 for auth-walled, no 500s)

| # | Phase | What |
|---|---|---|
| 1 | 0 | Workspace skeleton (`pnpm-workspace.yaml`, `apps/web`, `apps/functions`, Dockerfile monorepo standalone) |
| 2 | 1 | `@vibesboard/contracts` |
| 3 | 2 | `@vibesboard/utils` |
| 4 | 3 | `@vibesboard/adapter-firebase` (admin/client/storage with subpath exports) |
| 5 | 4 | `@vibesboard/adapter-openai` |
| 6 | 5 | `@vibesboard/adapter-google` + `adapter-stripe` |
| 7 | 6.1 | `@vibesboard/booking-enquiries` |
| 8 | 6.2 | `@vibesboard/scheduling` |
| 9 | 6.3 | `@vibesboard/data` |
| 10 | 6.4a | `@vibesboard/policy` (permissions, features, usage, plans, agent-links) |
| 11 | 6.4 | `@vibesboard/ai` + `agents` + `retrieval` (atomic cycle bundle, ~57 files) |
| 12 | 6.5 | `@vibesboard/inbox` + `channel-{whatsapp,instagram,chatwoot}` (atomic cycle bundle) |
| 13 | 7+8 | `@vibesboard/billing` + `@vibesboard/integrations` |
| 14 | 12 | Delete re-export shims, rewrite ~272 import sites onto `@vibesboard/*` directly |

Plus two non-phase improvements:
- Emulator-mode init in `packages/adapter-firebase/src/admin.ts` so local dev hits the emulator suite instead of production Firebase.
- Client-side `connectAuthEmulator()` wiring so the browser SDK also routes to the local auth emulator.

---

## 2. What's deferred

### 2.1 `@vibesboard/adapter-anthropic`

**What:** Wrap the Anthropic SDK behind `IAIProvider`, alongside `adapter-openai`.

**Why deferred:** No Anthropic SDK code in the project as of this writing. Creating the package speculatively would be a placeholder that nobody imports.

**Cost to do later:** Trivial (~half a day). Mirror `adapter-openai` structurally. Add when actual Anthropic usage lands.

**Unblocked by:** A real consumer needing Anthropic.

---

### 2.2 `@vibesboard/auth` and `@vibesboard/tenant`

**What:** Extract Next.js auth session handling (`apps/web/lib/firebase/{auth,route-handler}.ts`) and tenant context (`apps/web/lib/tenant-context.ts`, `tenant-theme.ts`) into feature packages.

**Why deferred:** All four files import `next/headers` (cookies()) and/or `next/server` (NextResponse). Feature packages should not depend on Next.js. Moving them out as-is would force `@vibesboard/auth` and `@vibesboard/tenant` to take a runtime dep on Next.js, which violates the spec's framework-agnostic intent.

**Same pattern as:**
- `apps/web/lib/access-gate.ts` — uses next/headers; kept in apps/web
- `apps/web/lib/agent-cookies.ts` — uses next/headers; kept in apps/web
- The hybrid `apps/web/lib/usage.ts` shim — re-exports `@vibesboard/policy/usage` and adds the one `NextResponse`-returning helper that the API route handlers need

**Cost to do later:** Medium (1-2 days). Two parts:

1. **Define ports in `@vibesboard/contracts`:**

   ```ts
   // packages/contracts/src/ports/request-context.ts
   export interface ICookies {
     get(name: string): { value: string } | undefined
     set(name: string, value: string, options: CookieOptions): void
     delete(name: string): void
   }

   export interface IRequestContext {
     readonly cookies: ICookies
     readonly headers: ReadonlyHeaders
     ipAddress(): string | null
   }
   ```

2. **Adapter for Next.js in apps/web:**

   ```ts
   // apps/web/lib/adapters/next-request-context.ts
   import { cookies, headers } from 'next/headers'
   import type { IRequestContext } from '@vibesboard/contracts'

   export async function nextRequestContext(): Promise<IRequestContext> {
     const c = await cookies()
     const h = await headers()
     return { cookies: c, headers: h, ipAddress: () => h.get('x-forwarded-for') }
   }
   ```

3. **Refactor feature code to accept `IRequestContext`** instead of calling `cookies()` directly. Call sites get a one-line addition: `const ctx = await nextRequestContext(); ...verifyAccessCookie(ctx, agentId)` instead of `verifyAccessCookie(agentId)`.

**Unblocked by:** Either (a) someone wants to use the auth/tenant logic outside Next.js, or (b) the same change being needed for Phase 11 enforcement (see §2.5).

---

### 2.3 `@vibesboard/ui`

**What:** Extract `apps/web/components/ui/` (26 Radix UI wrappers — Button, Card, Dialog, etc.) into a shared component package.

**Why deferred:** Single-app monorepo. 270+ import sites for zero structural payoff right now. The package model pays off when there's a second app (admin dashboard, marketing site, embeddable widget repo) consuming the same primitives.

**Cost to do later:** Low (~half a day for the mechanical move, plus the import-site sweep). Same pattern as the Phase 6.x extractions. Dependencies on `clsx`, `tailwind-merge`, `lucide-react`, `@radix-ui/*`.

**Unblocked by:** A second app landing, or a public design-system extraction goal.

---

### 2.4 App-only lib files

The following files in `apps/web/lib/` are intentionally not packaged and never will be unless they become reusable:

- **Landing copy:** `landing-{about,hero,services,showcase}-copy.ts` — marketing content for this product
- **Brand:** `base-branding.ts`, `fonts.ts`, `colors.ts`
- **App utilities:** `email.ts`, `qr.ts`, `redirects.ts`, `toast-helpers.tsx`, `validations.ts`, `analytics.ts`, `async-utils.ts`
- **React hooks:** `hooks/use-{agent-form,at-bottom,copy-to-clipboard,enter-submit,local-storage}.ts`
- **Webhooks:** `webhooks/{schema,verification}.ts` (Next.js-coupled)
- **Integration tests:** `lib/integration/*.test.ts` (cross-package smoke tests that exercise `apps/web` specifically)

These belong with the app. No action needed.

---

### 2.5 Phase 11 — ESLint `no-restricted-imports` enforcement

**What:** Add an ESLint rule that forbids feature packages from importing adapter packages, per the spec's strict-layering rule:

> Feature packages import only from `contracts`. They never `import { db } from '@vibesboard/adapter-firebase'`. Instead, they receive an `IDataStore` (defined in contracts) via constructor or factory argument.

**Why deferred:** As of Phase 12, feature packages **do** import adapter packages directly. This was a deliberate trade-off documented in the [Phase 6 sub-plan §1](2026-05-17-monorepo-phase-6-sub-plan.md). Turning on the lint rule today fails immediately across every feature package.

**The trade-off in numbers:** ~150 import sites across the feature packages directly import `@vibesboard/adapter-{firebase,openai,stripe,google}/*`. Each one needs to be replaced with constructor-injected port consumption.

**Unblocked by:** The DI refactor in §2.6.

---

### 2.6 DI refactor — the real Layer-2 work

**What:** Replace direct adapter imports in feature packages with constructor-injected ports from `@vibesboard/contracts`. This is what the spec actually means by "Layer 2 — features".

**Today (what shipped):**

```ts
// packages/policy/src/permissions.ts
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'

export async function getUserRole(userId: string, tenantId: string) {
  const doc = await adminDb.collection(Collections.members(tenantId)).doc(userId).get()
  // ...
}
```

**After DI refactor:**

```ts
// packages/policy/src/permissions.ts
import type { IDataStore, Collections } from '@vibesboard/contracts'

export function createPermissions(deps: { store: IDataStore }) {
  return {
    async getUserRole(userId: string, tenantId: string) {
      const doc = await deps.store
        .collection(Collections.members(tenantId))
        .doc(userId)
        .get()
      // ...
    }
  }
}
```

And the composition root in `apps/web`:

```ts
// apps/web/lib/composition-root.ts
import { firebaseDataStore } from '@vibesboard/adapter-firebase'
import { createPermissions } from '@vibesboard/policy'

export const permissions = createPermissions({
  store: firebaseDataStore()
})
```

**Why deferred:** This is real, invasive refactoring across every feature package. Not move-and-shim. Each function signature changes; every caller becomes a method call on a constructed object. Without DI, the package extraction still gives most of the benefit (clear boundaries, separate test surfaces, swap-points obvious). The strict-layering enforcement is the leftover prize.

**Cost to do later:** Medium-large (1-2 weeks for a careful pass). Suggested approach:

1. **Expand ports in `@vibesboard/contracts`** to cover the actual surface feature packages use today. Survey: `adminDb.collection().doc().get()/set()/update()`, `adminDb.collection().where().get()`, `adminDb.runTransaction()`, `adminDb.collectionGroup()`, plus the storage and auth equivalents. Start with `IDataStore` covering Firestore reads/writes that the current code performs.

2. **Refactor one feature package as a pattern** — the smallest one, `@vibesboard/booking-enquiries` (3 files, 4 callsites). Validate the shape. This is the "RFC commit" — gets the DI factory pattern, the composition root, the test approach right.

3. **Roll it out one feature package at a time** — typically a single PR per package:
   - `policy` (largest fan-in; do it second to validate the pattern at scale)
   - `scheduling`, `data` (similar shapes)
   - `billing`
   - `integrations` (pure data — likely no actual DI needed)
   - `ai`, `agents`, `retrieval` bundle (largest; do last)
   - `inbox`, `channel-*` bundle

4. **Flip Phase 11 ESLint** as the final commit.

**Unblocked by:** Architectural commitment. Could be staged over a quarter with no functional changes.

---

### 2.7 Strict-spec items not relevant for this codebase

The spec's success criteria §9 includes items that don't apply or are already satisfied differently:

| Spec criterion | Status |
|---|---|
| `lib/` is gone | **Partially** — `apps/web/lib/` retained for Next.js-coupled and app-only files (45 files vs. original 169). The strict reading would require §2.2 above to fully clear it. |
| Every business-logic file in `packages/*` has zero imports of Firebase, OpenAI, etc. SDKs | **Not yet** — same trade-off as Phase 11. Resolved by §2.6. |
| Adding a new adapter requires changes only in the adapter package + composition root | **Substantially** — the adapter packages exist and are swappable. The composition-root pattern is informal (deps come from direct imports, not a single root file). §2.6 formalizes it. |
| `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint` all pass in CI | **Yes for first three.** `pnpm lint` runs per package but no `no-restricted-imports` enforcement yet. |
| A new contributor can read `packages/<any>/src/index.ts` and understand its dependencies from the constructor signatures alone | **Partially.** Package boundaries are clear; constructor signatures are not yet the documentation surface because DI isn't wired (see §2.6). |

---

## 3. Recommended sequencing

If you pick this up later, in order of payoff-per-effort:

1. **Anthropic adapter** — only if a consumer materializes. Otherwise skip.
2. **`IRequestContext` port + apps/web Next adapter (§2.2)** — small, valuable, unblocks moving auth/tenant/access-gate. ~1-2 days.
3. **`@vibesboard/auth` + `@vibesboard/tenant`** — fall out of step 2. ~half a day each.
4. **DI refactor for `booking-enquiries`** — proof of concept. ~half a day.
5. **DI refactor rollout** — one package per session. Total spread over a few weeks.
6. **Phase 11 ESLint** — flip the switch. ~half a day.
7. **`@vibesboard/ui`** — only when a second app lands. ~half a day mechanical work then.

Nothing on this list blocks merging `feature/monorepo-split` to `dev` as-is.

---

## 4. How to validate the current branch end-to-end

Per the verification gate established in Phases 0-12:

```bash
pnpm install
pnpm -r type-check
pnpm --filter @vibesboard/web test
pnpm --filter @vibesboard/web build
cd apps/functions && npm run build && cd -

# Live smoke (requires the Firebase emulator suite + Next dev server):
firebase emulators:start &       # 9099 auth, 8080 firestore, 9199 storage, 4000 UI
pnpm --filter @vibesboard/web dev &  # 3000

curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/                    # 200
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/sign-up              # 200
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/user/active-tenant # 401
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/tenants/current    # 401
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/agents             # 401
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/booking-enquiries?agentId=x # 401
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/scheduling/connections # 401
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/data/connections       # 401
```

All eight should return what's annotated above. Any 500 indicates a regression that needs investigation before merging.
