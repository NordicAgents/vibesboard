# Monorepo Phase 6 Sub-Plan — Topological Extraction with Bundled Cycles

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the remaining business-logic folders under `apps/web/lib/` into the workspace package layout established by Phases 0-5, without breaking the build at any intermediate point.

**Approach:** Topological extraction — leaf packages first, then each dependency cycle moved as a single atomic PR. Defers the full DI refactor (port-based constructor injection) until after all packages exist; Phase 11 (ESLint enforcement) gets pushed accordingly.

**Tech Stack:** pnpm workspaces, `@vibesboard/*` packages, re-export shims at old `apps/web/lib/*` paths (deleted in Phase 12).

---

## 1. Approach choice — why Option 3 ("slice differently") with bundled cycles

The original Phase 6 spec assumed `ai` + `agents` could be extracted in two sub-steps (6a, 6b). The actual import graph in `apps/web/lib/` makes that impossible without preliminary work, because:

```
agent ─→ agents ─→ agent          (cycle 1: runtime ↔ CRUD)
agent ─→ retrieval ─→ agent       (cycle 2: runtime ↔ RAG)
inbox-agent ─→ whatsapp-inbox ─→ inbox-agent   (cycle 3: dispatcher ↔ channel)
inbox-agent ─→ instagram-inbox ─→ inbox-agent  (cycle 4)
```

Three viable options were on the table after Phase 5:

| | Option 1: One mega-PR | Option 2: DI refactor first | Option 3: Topological slicing |
|---|---|---|---|
| What | Move all of `agent`, `agents`, `retrieval`, `data`, `scheduling`, `inbox-agent`, `whatsapp-inbox`, `instagram-inbox`, `chatwoot`, `booking-enquiries` in a single PR | Expand `IDataStore`/`IAIProvider`/etc to cover all current adapter calls, then refactor every feature file to accept ports via DI, *then* move | Move acyclic leaves first; each cycle moves as a single bundled PR |
| Risk | Single point of failure. ~10 folder moves, ~80 files, hundreds of import rewrites all at once. Hard to bisect if something breaks. | Lowest end-state risk, highest in-progress risk: the DI work has no near-term user-visible benefit and is invasive across the codebase before any reorg payoff. | Each sub-phase is independently reviewable and revertable. Worst-case revert undoes one bundle. |
| End state | Matches spec on package layout. Feature → adapter imports remain (still need DI refactor later). | Matches spec on package layout AND strict layering. Done in one shot. | Matches spec on package layout. Feature → adapter imports remain. ESLint enforcement (Phase 11) deferred until DI refactor. |
| Effort | 1 large PR, 2-3 days | 5-7 PRs of DI refactor, then 5 PRs of moves — 1-2 weeks | 5 PRs total, each ~½ day to 1 day |
| Reviewability | Poor (huge diff, mixed concerns) | OK (DI PRs are focused) | Good (each PR is one folder or one cycle) |

**Choice: Option 3 with bundled cycles.** Each sub-phase produces a working, testable monorepo. The cycles (which prevent pure leaf-first ordering) get extracted as small bundles rather than expanding to one mega-PR.

**Deferred:**
- The DI refactor that satisfies the spec's "feature packages never import adapter packages" rule. Tracked as future Phase 13+.
- Phase 11 ESLint enforcement, which depends on the above.

---

## 2. Topological order

Surveyed via `grep "from '@/lib/<dir>'"` across each `apps/web/lib/<dir>/`:

```
                    ┌──────────────────────────────────────────────┐
                    │                  L A Y E R    0              │
                    │  @vibesboard/contracts (done — Phase 1)       │
                    │  @vibesboard/utils     (done — Phase 2)       │
                    └──────────────────┬───────────────────────────┘
                                       │
                    ┌──────────────────┴───────────────────────────┐
                    │                  L A Y E R    1              │
                    │  @vibesboard/adapter-{firebase,openai,        │
                    │     google,stripe}  (done — Phases 3-5)       │
                    └──────────────────┬───────────────────────────┘
                                       │
        Phase 6.1   ┌──────────────────┴───────────────────────────┐
        ─────────►  │  @vibesboard/booking-enquiries  (LEAF)        │
                    │  deps: contracts, adapter-firebase            │
                    └───────────────────────────────────────────────┘

        Phase 6.2   ┌───────────────────────────────────────────────┐
        ─────────►  │  @vibesboard/scheduling  (LEAF)               │
                    │  deps: contracts, adapter-firebase            │
                    └──────────────────┬────────────────────────────┘
                                       │
        Phase 6.3   ┌──────────────────┴────────────────────────────┐
        ─────────►  │  @vibesboard/data                             │
                    │  deps: contracts, adapter-firebase, scheduling│
                    └───────────────────────────────────────────────┘

        Phase 6.4   ┌───────────────────────────────────────────────┐
        ─────────►  │  CYCLE BUNDLE — single atomic PR              │
                    │  @vibesboard/ai         (lib/agent/ → here)   │
                    │  @vibesboard/agents     (lib/agents/ → here)  │
                    │  @vibesboard/retrieval  (lib/retrieval/)      │
                    │  deps: everything above + adapter-openai      │
                    └──────────────────┬────────────────────────────┘
                                       │
        Phase 6.5   ┌──────────────────┴────────────────────────────┐
        ─────────►  │  CYCLE BUNDLE — single atomic PR              │
                    │  @vibesboard/inbox          (lib/inbox-agent/)│
                    │  @vibesboard/channel-whatsapp                 │
                    │  @vibesboard/channel-instagram                │
                    │  @vibesboard/channel-chatwoot                 │
                    │  deps: ai, agents, adapter-firebase           │
                    └───────────────────────────────────────────────┘
```

Each Phase 6.x is a separate PR on `feature/monorepo-split`. Verification gate is identical to Phases 0-5: `pnpm -r type-check`, `pnpm --filter @vibesboard/web test`, `pnpm --filter @vibesboard/web build`, manual smoke test against running emulators.

---

## 3. Cross-cutting rules (apply to every sub-phase)

These show up repeatedly — call them out once here, reference from each sub-phase task.

1. **Path-alias rewrites.** When a file moves out of `apps/web/`, the `@/lib/...` aliases stop resolving. Every `@/lib/<dir>/<file>` import inside the moved file becomes either:
   - `@vibesboard/<package>` if the target is already extracted
   - `@vibesboard/<package>/<subpath>` if the target uses subpath exports (adapter-firebase, adapter-stripe)
   - Stays as `@/lib/...` if the target is still in apps/web — but **only if the importer also stays in apps/web**. If the importer moved out, the alias breaks.

2. **Test files move with their code.** `apps/web/package.json` test script globs `lib/**/*.test.ts`. Move `lib/<dir>/*.test.ts` into the new package and add a per-package test script that runs `node --experimental-strip-types --test src/**/*.test.ts`. Root `package.json` "test" delegates to `pnpm -r test`.

3. **Re-export shims at old paths** are the migration lifeline. For each moved file `apps/web/lib/<dir>/<file>.ts`, leave behind:

   ```ts
   // apps/web/lib/<dir>/<file>.ts
   export * from '@vibesboard/<package>'        // for barrel-exported files
   // or
   export * from '@vibesboard/<package>/<file>' // for subpath-exported files
   ```

   Shims stay until Phase 12 (`lib/` deletion).

4. **Barrel `.ts` extensions.** Phase 4 established that package barrel files must use explicit `.ts` extensions in `export * from './X.ts'` for the Node `--experimental-strip-types` test runner. Every new package barrel follows the same rule.

5. **No DI refactor in Phase 6.** Feature packages may import `@vibesboard/adapter-firebase`, `@vibesboard/adapter-openai`, etc. directly. This is the deliberate trade-off documented in §1 — strict-layering enforcement (Phase 11) waits until Phase 13+ DI work.

6. **Per-package `package.json` template** (matches Phases 1-5):

   ```json
   {
     "name": "@vibesboard/<name>",
     "version": "0.0.0",
     "private": true,
     "main": "./src/index.ts",
     "types": "./src/index.ts",
     "exports": { ".": "./src/index.ts" },
     "scripts": {
       "type-check": "tsc --noEmit",
       "test": "node --experimental-strip-types --test --experimental-test-isolation=none 'src/**/*.test.ts'"
     },
     "dependencies": { ... workspace deps ... },
     "devDependencies": {
       "@types/node": "^25.6.0",
       "typescript": "^5.9.3"
     }
   }
   ```

   And `tsconfig.json`:

   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": { "rootDir": "./src", "types": ["node"] },
     "include": ["src/**/*"]
   }
   ```

---

## Phase 6.1 — Extract `@vibesboard/booking-enquiries` (LEAF, ~½ day)

**Files in scope:** `apps/web/lib/booking-enquiries/*.ts` (3 files)

**Cross-feature imports** (per the dep survey):
- `@/lib/firebase/admin` → `@vibesboard/adapter-firebase/admin`
- `@/lib/firestore-types` → `@vibesboard/contracts`
- `@/lib/types` → `@vibesboard/contracts`

No imports to other feature folders — true leaf.

**Files:**
- Create: `packages/booking-enquiries/package.json` (deps: contracts, adapter-firebase)
- Create: `packages/booking-enquiries/tsconfig.json`
- Create: `packages/booking-enquiries/src/index.ts` (barrel re-exporting each file with `.ts` extension)
- Move: `apps/web/lib/booking-enquiries/*.ts` → `packages/booking-enquiries/src/`
- Modify: `apps/web/lib/booking-enquiries/*.ts` → re-export shim
- Modify: `apps/web/package.json` (add `@vibesboard/booking-enquiries: workspace:*` dep)

- [ ] **Step 6.1.1: Inventory current files and exports**

```bash
ls apps/web/lib/booking-enquiries/
grep -hn '^export' apps/web/lib/booking-enquiries/*.ts
```

Write the inventory into a one-paragraph comment at the top of the new `index.ts` barrel — useful for the next sub-phase author.

- [ ] **Step 6.1.2: Create package skeleton**

```bash
mkdir -p packages/booking-enquiries/src
```

Write the three template files (`package.json`, `tsconfig.json`, `src/index.ts`) using the templates in §3.6. Dependencies block:

```json
"dependencies": {
  "@vibesboard/adapter-firebase": "workspace:*",
  "@vibesboard/contracts": "workspace:*",
  "server-only": "^0.0.1"
}
```

- [ ] **Step 6.1.3: Move files with `git mv`**

```bash
git mv apps/web/lib/booking-enquiries/*.ts packages/booking-enquiries/src/
```

`git mv` preserves blame, which matters because these files have ownership history.

- [ ] **Step 6.1.4: Rewrite imports in moved files**

For each moved file, sed-style:
- `from '@/lib/firebase/admin'` → `from '@vibesboard/adapter-firebase/admin'`
- `from '@/lib/firestore-types'` → `from '@vibesboard/contracts'`
- `from '@/lib/types'` → `from '@vibesboard/contracts'`

Verify with `grep -rn "@/lib/" packages/booking-enquiries/src/` — should return empty.

- [ ] **Step 6.1.5: Write the index.ts barrel**

```ts
// @vibesboard/booking-enquiries — booking-enquiry CRUD and lifecycle.
//
// Used by @vibesboard/scheduling and api routes under
// apps/web/app/api/.../bookingEnquiries/.

export * from './<file1>.ts'
export * from './<file2>.ts'
export * from './<file3>.ts'
```

Replace `<fileN>` with the actual filenames from Step 6.1.1.

- [ ] **Step 6.1.6: Write re-export shims at old paths**

For each moved file, recreate `apps/web/lib/booking-enquiries/<file>.ts` as:

```ts
// Re-export shim — real implementation in @vibesboard/booking-enquiries.
// Deleted in Phase 12.
export * from '@vibesboard/booking-enquiries'
```

(The shim points at the package barrel, not at a subpath — every shim file gets the full barrel; consumers' named imports filter naturally.)

- [ ] **Step 6.1.7: Wire dep into apps/web**

Edit `apps/web/package.json` `dependencies`:

```json
"@vibesboard/booking-enquiries": "workspace:*",
```

Run `pnpm install`.

- [ ] **Step 6.1.8: Verify**

```bash
pnpm install
pnpm -r type-check
pnpm --filter @vibesboard/web test
pnpm --filter @vibesboard/web build
```

All four must pass. If type-check fails on a downstream file, the shim path is wrong — most likely the package barrel didn't re-export a symbol the shim claimed.

- [ ] **Step 6.1.9: Commit**

```bash
git add -A
git commit -m "feat(monorepo): phase 6.1 — extract @vibesboard/booking-enquiries

Leaf package — no cross-feature deps. Moves apps/web/lib/booking-enquiries/
(3 files) into packages/booking-enquiries/. Old paths remain as re-export
shims. Verified: workspace type-check, 275 tests pass, web build green.

Per docs/superpowers/plans/2026-05-17-monorepo-phase-6-sub-plan.md §6.1.

Co-Authored-By: <agent-id>"
```

---

## Phase 6.2 — Extract `@vibesboard/scheduling` (LEAF, ~½ day)

**Files in scope:** `apps/web/lib/scheduling/*.ts` (6 files), including `providers/google-calendar.ts` and `google-auth.ts`

**Cross-feature imports:**
- `@/lib/firebase/admin` → `@vibesboard/adapter-firebase/admin`
- `@/lib/firestore-types` → `@vibesboard/contracts`

No feature-to-feature imports.

**Notable:** `providers/google-calendar.ts` and `google-auth.ts` are the Google Calendar OAuth + provider code that Phase 5 deferred. They land here, not in `adapter-google`, because they're scheduling-feature glue (resource lookup, slot availability) not pure Google SDK wrapping. If the spec's IBilling-style port for calendar (`ICalendarProvider`) gets fleshed out later, the Google-specific bits move to `adapter-google` and the scheduling package keeps the port-consuming logic.

**Files:**
- Create: `packages/scheduling/{package.json, tsconfig.json, src/index.ts}`
- Move: `apps/web/lib/scheduling/*.ts` (including `providers/*`, `google-auth.ts`) → `packages/scheduling/src/`
- Modify: each moved file's imports (same rewrites as 6.1)
- Modify: `apps/web/lib/scheduling/*.ts` → re-export shims (preserve subdir structure)
- Modify: `apps/web/package.json` (add dep)

- [ ] **Step 6.2.1-6.2.9** — mirror Phase 6.1 exactly, substituting "scheduling" for "booking-enquiries". The only structural difference: scheduling has a `providers/` subdir. Mirror it in the package:

  ```
  packages/scheduling/
  └── src/
      ├── index.ts
      ├── connections.ts
      ├── google-auth.ts
      └── providers/
          ├── index.ts
          └── google-calendar.ts
  ```

  Each subdir gets its own `index.ts` barrel. The shim at `apps/web/lib/scheduling/providers/google-calendar.ts` re-exports from `@vibesboard/scheduling` (the barrel re-exports everything including providers).

---

## Phase 6.3 — Extract `@vibesboard/data` (TIER 2, ~½ day)

**Files in scope:** `apps/web/lib/data/*.ts` (8 files), Google Sheets / Airtable / webhook data action providers.

**Cross-feature imports:**
- `@/lib/firebase/admin` → `@vibesboard/adapter-firebase/admin`
- `@/lib/firestore-types` → `@vibesboard/contracts`
- `@/lib/scheduling` → `@vibesboard/scheduling` ⚠ (only resolvable AFTER Phase 6.2 lands)

**Files:** structurally identical to 6.1/6.2.

- [ ] **Step 6.3.1-6.3.9** — same shape as 6.1, with an additional rewrite:
  - `from '@/lib/scheduling/connections'` → `from '@vibesboard/scheduling'`
  - `from '@/lib/scheduling/providers'` → `from '@vibesboard/scheduling'`

  Dependencies block:

  ```json
  "dependencies": {
    "@vibesboard/adapter-firebase": "workspace:*",
    "@vibesboard/contracts": "workspace:*",
    "@vibesboard/scheduling": "workspace:*",
    "server-only": "^0.0.1"
  }
  ```

---

## Phase 6.4 — Bundled extraction: `@vibesboard/ai` + `@vibesboard/agents` + `@vibesboard/retrieval` (CYCLE BUNDLE, 2 days)

**Why bundled:** the three folders form a strongly-connected component in the import graph.

```
agent  ──imports──→ agents/server     (handoff dispatch)
agents ──imports──→ agent/handoff     (test agent in editor)
agent  ──imports──→ retrieval         (RAG retriever)
retrieval ──imports──→ agent/embeddings (chunking helpers)
```

Extracting any one in isolation leaves a dangling `@/lib/...` import that won't resolve from the new package. The minimum-viable atomic unit is all three.

**Files in scope:**
- `apps/web/lib/agent/*` (32 files) → `packages/ai/src/`
- `apps/web/lib/agents/*` (20 files) → `packages/agents/src/`
- `apps/web/lib/retrieval/*` (5 files) → `packages/retrieval/src/`

**Cross-feature imports that all become package imports:**
- `@/lib/firebase/admin` → `@vibesboard/adapter-firebase/admin`
- `@/lib/firebase/storage` → `@vibesboard/adapter-firebase/storage`
- `@/lib/firestore-types`, `@/lib/types`, `@/lib/types/message` → `@vibesboard/contracts`
- `@/lib/openai`, `@/lib/openai-compat` → `@vibesboard/adapter-openai`
- `@/lib/utils/sanitize`, `@/lib/utils/fetch-with-retry` → `@vibesboard/utils`
- `@/lib/scheduling/*` → `@vibesboard/scheduling`
- `@/lib/data/*` → `@vibesboard/data`
- `@/lib/agent/*` → `@vibesboard/ai` (intra-bundle)
- `@/lib/agents/*` → `@vibesboard/agents` (intra-bundle)
- `@/lib/retrieval/*` → `@vibesboard/retrieval` (intra-bundle)
- `@/lib/features`, `@/lib/permissions`, `@/lib/usage`, `@/lib/agent-links` → stay as `@/lib/...` BUT — these files are still in `apps/web/lib/`, and the moved feature package can't use `@/...` aliases. The fix: either also extract these as part of 6.4 (bloating the bundle), or keep them in `apps/web/lib/` and have the feature package reach them via an intermediate package.

  **Decision:** create a lightweight `@vibesboard/policy` package in 6.4 that wraps `permissions`, `features`, `usage`, `agent-links` from apps/web. These are small files (`permissions.ts` 200 LOC, `features.ts` similar) and don't have outbound feature deps. Treating them as part of 6.4's bundle keeps the cycle-bundle move clean.

  *Alternatively*, a smaller move would leave them in apps/web and add path-alias resolution from the package to apps/web — but that's a structural anti-pattern (packages reaching back into apps). The `@vibesboard/policy` add is cleaner.

- `next/headers` (in `apps/web/lib/agent/cookies.ts`) → this file is Next.js-coupled. **Keep `cookies.ts` in apps/web** (it's a Next.js framework adapter, not domain logic). Add a `ITenantCookies` port in contracts and have agent code consume that; for now, agent runtime imports from `@/lib/agent/cookies` via the shim that points back at `apps/web/lib/agent/cookies.ts` — wait, no, that's not possible once agent moves out. **Refined decision:** `cookies.ts` moves to `apps/web/lib/cookies.ts` (out of agent/), and the agent runtime receives the cookie store as a constructor argument. This is the one DI carve-out 6.4 takes on. Without it, the bundle would also need to absorb the apps/web Next.js framework code, which is wrong.

**Pre-flight survey** (do this BEFORE the move):

```bash
# Confirm the dep graph one more time
grep -rhn "from '@/lib/" apps/web/lib/agent apps/web/lib/agents apps/web/lib/retrieval --include="*.ts" \
  | grep -v test.ts \
  | sed -E "s|.*from '@/lib/([a-z-]+).*|\1|" | sort -u

# Count the import rewrites needed
grep -rn "from '@/lib/" apps/web/lib/agent apps/web/lib/agents apps/web/lib/retrieval --include="*.ts" \
  | grep -v test.ts | wc -l
```

The count tells you exactly how many `from '@/lib/...'` rewrites the bundle requires. Track it — if it's >300, consider splitting into two PRs (e.g. extract retrieval separately if its cycle with agent is light enough — i.e., if `agent → retrieval` is heavier than `retrieval → agent`, you can introduce an `IRetriever` port in contracts to break that one cycle and extract retrieval first).

**Sub-phases inside 6.4:**

- [ ] **Step 6.4.1: Survey and freeze**

  Run the pre-flight survey commands. Save output to a scratch file. Decide on the policy-package scope. Confirm `cookies.ts` carve-out.

- [ ] **Step 6.4.2: Extract `@vibesboard/policy` first**

  Smallest sub-step. Files: `apps/web/lib/{permissions.ts, permissions-core.ts, features.ts, feature-flags.ts, usage.ts, usage-core.ts, usage-types.test.ts, agent-links/}`.

  Same pattern as Phase 6.1: package skeleton, move with `git mv`, import rewrites, shims, dep wiring, verify, commit.

- [ ] **Step 6.4.3: Move `cookies.ts` out of `agent/`**

  ```bash
  git mv apps/web/lib/agent/cookies.ts apps/web/lib/agent-cookies.ts
  ```

  Update the two existing call sites (find them with `grep -rn "from '@/lib/agent/cookies'"`). This is a same-app refactor — no new package.

- [ ] **Step 6.4.4: Create the three package skeletons in parallel**

  `packages/ai/`, `packages/agents/`, `packages/retrieval/` — each with `package.json` + `tsconfig.json` + empty `src/index.ts`. Cross-deps in package.json:

  ```json
  // packages/ai/package.json deps
  "@vibesboard/adapter-firebase": "workspace:*",
  "@vibesboard/adapter-openai": "workspace:*",
  "@vibesboard/agents": "workspace:*",
  "@vibesboard/contracts": "workspace:*",
  "@vibesboard/data": "workspace:*",
  "@vibesboard/policy": "workspace:*",
  "@vibesboard/retrieval": "workspace:*",
  "@vibesboard/scheduling": "workspace:*",
  "@vibesboard/utils": "workspace:*"
  ```

  Similar for `agents` and `retrieval` — copy the import survey output into each package.json.

  Run `pnpm install`. Verify all three packages typecheck (empty barrels, so trivially).

- [ ] **Step 6.4.5: Move retrieval first** (smallest of the three, 5 files)

  `git mv apps/web/lib/retrieval/* packages/retrieval/src/`, rewrite imports, write the index.ts barrel, write shims, verify.

  At this point `packages/retrieval/src/<file>.ts` has imports like `from '@vibesboard/ai'` (intra-bundle) that won't resolve yet because `@vibesboard/ai/src/index.ts` is empty. Workaround: in 6.4.5 only, rewrite those imports to stay as `from '@/lib/agent/embeddings'` etc — they'll temporarily break typecheck. That's intentional. Mark the failing files in a `// TODO(phase-6.4.6)` comment and move on. **Do not commit 6.4.5 alone — it leaves a broken tree.**

- [ ] **Step 6.4.6: Move agents** (20 files)

  Same pattern. After this step, intra-bundle imports `from '@vibesboard/agents'` start resolving (for files moved here). Still some `from '@/lib/agent/...'` imports that won't resolve yet.

- [ ] **Step 6.4.7: Move agent → ai** (32 files)

  Same pattern. After this step, the intra-bundle cycle closes. Now go back and resolve the `TODO(phase-6.4.6)` comments — rewrite to the proper `@vibesboard/{ai,agents}/...` paths.

- [ ] **Step 6.4.8: Re-export shims at old paths**

  For every moved file `apps/web/lib/{agent,agents,retrieval}/<path>/<file>.ts`, create a shim at the old path pointing at the new package barrel. This is the largest single chunk of file creation in Phase 6 — generate them with a one-liner script:

  ```bash
  for f in $(git diff HEAD --name-only --diff-filter=R | grep -E "^packages/(ai|agents|retrieval)/src/"); do
    pkg=$(echo $f | sed -E 's|packages/([a-z]+)/.*|\1|')
    old=$(git log --diff-filter=R --name-status -1 -- "$f" | grep ^R | awk '{print $2}')
    [ -n "$old" ] && echo "// Re-export shim
export * from '@vibesboard/$pkg'" > "$old"
  done
  ```

  (Or write a 20-line shell script in `scripts/generate-shims.sh` since this pattern recurs.)

- [ ] **Step 6.4.9: Verify the full bundle**

  ```bash
  pnpm install
  pnpm -r type-check
  pnpm --filter @vibesboard/web test     # all 275 still pass
  pnpm --filter @vibesboard/web build
  # Smoke test against running emulators:
  curl http://localhost:3000/                                  # 200
  curl http://localhost:3000/api/user/active-tenant            # 401 (admin SDK working)
  curl http://localhost:3000/api/tenants/current               # 401
  ```

  If type-check has >0 errors at this stage, the bundle is broken — DO NOT commit. Diagnose and fix before committing. The 275 test count is a regression gate.

- [ ] **Step 6.4.10: Commit the bundle as a single commit**

  ```bash
  git add -A
  git commit -m "feat(monorepo): phase 6.4 — extract @vibesboard/{ai,agents,retrieval,policy}

Bundled atomic move — these three folders form a strongly-connected
component in the import graph (agent ↔ agents, agent ↔ retrieval). Cannot
be split without DI refactor.

Also extracts @vibesboard/policy (permissions, features, usage, agent-links)
as a small leaf that the bundle depends on, and refactors lib/agent/cookies.ts
out of agent/ to apps/web/lib/agent-cookies.ts (the next/headers-coupled
piece stays in apps/web).

~57 files moved, ~280 @/lib/* import rewrites, all 275 tests still pass.

Per docs/superpowers/plans/2026-05-17-monorepo-phase-6-sub-plan.md §6.4.

Co-Authored-By: <agent-id>"
  ```

---

## Phase 6.5 — Bundled extraction: `@vibesboard/inbox` + channels (CYCLE BUNDLE, 1 day)

**Why bundled:** same shape as 6.4, smaller. `inbox-agent` imports from `whatsapp-inbox` and `instagram-inbox`, and both channels import the dispatcher.

**Files in scope:**
- `apps/web/lib/inbox-agent/*` (4 files) → `packages/inbox/src/`
- `apps/web/lib/whatsapp-inbox/*` (6 files) → `packages/channel-whatsapp/src/`
- `apps/web/lib/instagram-inbox/*` (6 files) → `packages/channel-instagram/src/`
- `apps/web/lib/chatwoot/*` (3 files) → `packages/channel-chatwoot/src/`

**Note on chatwoot:** chatwoot has no cycle with inbox-agent (`chatwoot` imports `agent`/`agents` but not vice versa). It's technically a leaf relative to the inbox cycle and could move in its own PR. But it's small (3 files) and conceptually a channel, so it rides in the same bundle.

**Cross-feature imports:**
- All the standard rewrites (firebase, contracts, utils, etc.)
- `@/lib/agent/*` → `@vibesboard/ai` (only resolvable after 6.4)
- `@/lib/agents/*` → `@vibesboard/agents` (only resolvable after 6.4)
- Intra-bundle imports for the cycle

**Sub-phases:**

- [ ] **Step 6.5.1-6.5.10** — mirror 6.4 exactly, smaller in scope:
  - 6.5.1: pre-flight survey
  - 6.5.2: package skeletons (4 packages: `inbox`, `channel-whatsapp`, `channel-instagram`, `channel-chatwoot`)
  - 6.5.3-6.5.6: move each folder (one per step), with TODO comments for intra-bundle imports during transition
  - 6.5.7: re-export shims
  - 6.5.8: verify (typecheck, test, build, smoke test)
  - 6.5.9: commit as single bundle

---

## 4. Post-Phase-6 state

After 6.1-6.5 land, `apps/web/lib/` contains only:
- Re-export shims (deleted in Phase 12)
- `apps/web/lib/agent-cookies.ts` (the Next.js-coupled file extracted from `agent/`)
- A handful of small leaves not worth extracting (e.g. `colors.ts`, `email.ts`, `qr.ts`, `landing-*-copy.ts`, `analytics.ts`, `redirects.ts`) — these can absorb into apps/web permanently or move to `@vibesboard/web-utils` in a follow-up

Package layout matches the spec's §3 inventory except for:
- `@vibesboard/billing` not extracted — Phase 9 in the original spec, deferred (the stripe-helpers etc. are still in apps/web)
- `@vibesboard/integrations` not extracted — Phase 9 in the original spec, deferred
- `@vibesboard/auth` not extracted — Phase 10 in the original spec, deferred (auth.ts and route-handler.ts still in apps/web/lib/firebase/)
- `@vibesboard/tenant` not extracted — Phase 2 carry-over from original spec
- `@vibesboard/ui` not extracted — Phase 10 in the original spec, deferred (components/ still in apps/web)

These remaining packages can extract via the same pattern. None form additional cycles (they were already moveable in Phases 0-5 ordering; we just didn't get to them).

**Deferred work** (tracked, not in scope here):
- DI refactor → port-based constructor injection (the spec's strict layering rule)
- Phase 11 ESLint enforcement (blocked on DI)
- Phase 12 `lib/` deletion (blocked on extracting auth, billing, integrations, tenant, ui)

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **6.4 bundle is too large to review** | Each sub-step (6.4.2-6.4.7) is its own commit on the branch. The final PR can be reviewed commit-by-commit. If the bundle is genuinely unreviewable, fall back to extracting retrieval first via an `IRetriever` port in contracts (small DI carve-out). |
| **Intra-bundle imports break typecheck mid-bundle** | Documented explicitly in 6.4.5: do not commit mid-bundle. Use `// TODO(phase-6.4.7)` markers and resolve before the bundle's verification step. |
| **Hidden cross-imports surface during the move** | Pre-flight survey in step N.1 of each sub-phase. Track the `@/lib/` import count. If actual rewrites exceed survey-predicted count by >10%, stop and re-survey — there's a transitive import that wasn't caught. |
| **`apps/functions` build breaks** | Functions is intentionally outside the pnpm workspace. Its only `apps/web/lib` couplings (if any — survey first) would have been broken at Phase 3 already; if Phase 3 was green, Phase 6 doesn't add new risk. Verify with `cd apps/functions && npm run build` after each sub-phase. |
| **Cloud Run / Dockerfile breakage** | Dockerfile is monorepo-aware as of Phase 0. New packages get `COPY apps/web/package.json ./apps/web/` style lines only if they have build-time scripts (they don't — source-only packages). No Dockerfile change needed per sub-phase. |
| **Subagent loses context across the bundle** | If running 6.4 via subagent-driven-development, give each sub-step (6.4.1-6.4.10) to its own subagent with explicit "this is part of the 6.4 bundle, do not commit until step 6.4.10" instruction. |

---

## 6. Per-sub-phase verification gate (copy/paste)

```bash
pnpm install
pnpm -r type-check          # must pass — strict gate
pnpm --filter @vibesboard/web test  # 275/275 — regression gate
pnpm --filter @vibesboard/web build # standalone build — production gate
cd apps/functions && npm run build && cd - # functions build — deploy gate

# Live smoke test (requires firebase emulators + next-web running per
# .claude/launch.json):
curl -sS http://localhost:3000/                              # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" \
  http://localhost:3000/api/user/active-tenant               # expect 401
curl -sS -o /dev/null -w "%{http_code}\n" \
  http://localhost:3000/api/tenants/current                  # expect 401
```

All five must pass before committing a sub-phase.
