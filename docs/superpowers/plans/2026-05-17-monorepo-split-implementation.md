# Monorepo Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the single-app Next.js codebase to a pnpm monorepo with feature/adapter/contracts layering, as designed in [2026-05-16-monorepo-split-design.md](../specs/2026-05-16-monorepo-split-design.md).

**Architecture:** Strict three-layer rule (apps → features → adapters → contracts). Each phase is strictly additive — old `lib/*` paths remain as re-export shims until Phase 12. Every phase ends green: `pnpm typecheck` + `pnpm test` + `pnpm build`.

**Tech Stack:** pnpm workspaces, TypeScript (no per-package build step — sources consumed directly via paths), Next.js 16, Firebase Functions.

---

## Phase 0 — Workspace Skeleton

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`
- Create: `apps/functions/package.json`, `apps/functions/tsconfig.json` (move from `functions/`)
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`
- Modify: root `package.json` (delegate scripts to workspace)
- Move: `app/`, `components/`, `lib/`, `hooks/`, `middleware.ts`, `next.config.js`, `tailwind.config.js`, `postcss.config.js`, `auth.ts`, `public/`, `assets/`, `types/`, `firestore.rules`, etc. → into `apps/web/`
- Move: `functions/*` → `apps/functions/`

- [ ] **Step 0.1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 0.2: Create `tsconfig.base.json` at root**

Shared compiler options that per-package tsconfigs extend. Strict mode, ES2022 target, moduleResolution bundler.

- [ ] **Step 0.3: Move Next.js app into `apps/web/`**

Move app source dirs (`app/`, `components/`, `lib/`, `hooks/`, `middleware.ts`, `public/`, `assets/`, `types/`) and config files (`next.config.js`, `tailwind.config.js`, `postcss.config.js`, `eslint.config.js`, `prettier.config.cjs`, `auth.ts`) into `apps/web/`. Keep Firebase config (`firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `cors.json`) at root since they orchestrate both apps.

- [ ] **Step 0.4: Move `functions/` → `apps/functions/`**

- [ ] **Step 0.5: Create per-app `package.json` and `tsconfig.json`**

Split current root `package.json` into a workspace root + `apps/web/package.json`. Root keeps only workspace orchestration scripts. `apps/web/package.json` carries the app deps.

- [ ] **Step 0.6: Create empty `packages/contracts`**

Placeholder `src/index.ts` (`export {}`), minimal `package.json` with `name: "@vibesboard/contracts"`, `main: "./src/index.ts"`.

- [ ] **Step 0.7: Update `firebase.json` and deploy scripts**

`firebase.json` `functions.source` → `apps/functions`. `deploy-cloud-run.sh` and any path-dependent scripts updated.

- [ ] **Step 0.8: Verify**

```bash
pnpm install
pnpm --filter @vibesboard/web type-check
pnpm --filter @vibesboard/web test
pnpm --filter @vibesboard/web build
pnpm --filter vibeagent-functions build
```

All four pass.

- [ ] **Step 0.9: Commit**

```bash
git add -A
git commit -m "feat(monorepo): phase 0 — workspace skeleton (apps/web, apps/functions, packages/contracts)"
```

---

## Phase 1 — Extract `@vibesboard/contracts`

**Files:**
- Create: `packages/contracts/src/domain/{agent,message,tenant,permissions}.ts` (pure types)
- Create: `packages/contracts/src/ports/{data-store,auth,storage,ai-provider,calendar-provider,billing,inbox-channel}.ts`
- Modify: `apps/web/lib/firestore-types.ts` → re-export shim
- Modify: `apps/web/lib/types.ts` → re-export shim (for the pure-type parts; runtime parts stay)
- Modify: `apps/web/lib/permissions-core.ts` → re-export shim
- Modify: `apps/web/lib/types/message.ts` → re-export shim

- [ ] **Step 1.1: Identify pure-type exports**

From `lib/firestore-types.ts`, `lib/types.ts`, `lib/types/message.ts`, `lib/permissions-core.ts` — every `type` / `interface` / `const enum` / pure constant (like `Collections`) gets moved to contracts. Any runtime helpers stay in `apps/web/lib/*`.

- [ ] **Step 1.2: Move types to `packages/contracts/src/domain/`**

Group by domain: `agent.ts` (Agent, AgentTool, AgentMode, …), `message.ts`, `tenant.ts` (TenantDocument, TenantBrandingDocument, MemberSummary, Collections), `permissions.ts`.

- [ ] **Step 1.3: Define minimal port interfaces**

Start with skeletons that match what current code uses:
- `IDataStore` — `collection()`, `transaction()`
- `IAuth` — `verifySession()`, `getUser()`
- `IStorage` — `upload()`, `getSignedUrl()`
- `IAIProvider` — `complete()`, `embed()`
- `ICalendarProvider` — `listAvailability()`, `book()`
- `IBilling` — `recordUsage()`, `getQuota()`
- `IInboxChannel` — `handleWebhook()`, `sendMessage()`

These ports will be expanded as adapters get extracted in later phases.

- [ ] **Step 1.4: Replace old type files with re-export shims**

```ts
// apps/web/lib/firestore-types.ts
export * from '@vibesboard/contracts'
```

For partial files where runtime code remains, keep the runtime code but `export type *` from contracts.

- [ ] **Step 1.5: Wire `@vibesboard/contracts` into `apps/web` and `apps/functions`**

Add to `package.json` `dependencies`: `"@vibesboard/contracts": "workspace:*"`. Add path mapping to `apps/web/tsconfig.json` so `@/lib/...` imports still resolve.

- [ ] **Step 1.6: Verify**

```bash
pnpm --filter @vibesboard/web type-check
pnpm --filter @vibesboard/web test
pnpm --filter @vibesboard/web build
```

All green. Spot-check 5 random files in `lib/` and `app/` — imports should resolve unchanged.

- [ ] **Step 1.7: Commit**

```bash
git commit -m "feat(monorepo): phase 1 — extract @vibesboard/contracts with re-export shims"
```

---

## Phase 2 — Extract `@vibesboard/utils`

**Files:**
- Create: `packages/utils/package.json`, `packages/utils/tsconfig.json`, `packages/utils/src/{index,fetch-with-retry,sanitize}.ts`
- Modify: `apps/web/lib/utils/fetch-with-retry.ts` → re-export shim
- Modify: `apps/web/lib/utils/sanitize.ts` → re-export shim

Note: The spec also lists `tenant-context.ts` for Phase 2, but it imports `next/headers` and `firebase-admin/firestore` directly — not a pure utility. It moves later (Phase 6 region after the firebase adapter exists).

- [ ] **Step 2.1: Move `lib/utils/*` → `packages/utils/src/`**

`fetch-with-retry.ts` and `sanitize.ts` have no I/O and no Firebase/Next dependencies — clean lift.

- [ ] **Step 2.2: Replace old paths with re-export shims**

- [ ] **Step 2.3: Verify**

```bash
pnpm --filter @vibesboard/web type-check
pnpm --filter @vibesboard/web test
pnpm --filter @vibesboard/web build
```

- [ ] **Step 2.4: Commit**

```bash
git commit -m "feat(monorepo): phase 2 — extract @vibesboard/utils"
```

---

## Phase 3+ — Adapters and Feature Packages

Phases 3-12 follow the same strict-additive pattern (re-export shims at old paths, new package, verify, commit). Detailed steps are deferred until Phase 2 lands and we revalidate assumptions on a real Phase 1 result. See [the spec §7](../specs/2026-05-16-monorepo-split-design.md) for the per-phase contract:

- **Phase 3** — wrap `lib/firebase/*` as `@vibesboard/adapter-firebase` (proof of concept for adapter pattern)
- **Phase 4** — wrap OpenAI + Anthropic as `@vibesboard/adapter-{openai,anthropic}`
- **Phase 5** — wrap Google + Stripe as adapters
- **Phase 6a/6b** — extract `@vibesboard/ai` then `@vibesboard/agents`
- **Phase 7** — extract `@vibesboard/retrieval`
- **Phase 8** — extract inbox + per-channel adapters
- **Phase 9** — scheduling, billing, integrations
- **Phase 10** — auth, ui
- **Phase 11** — enforce import rules with ESLint `no-restricted-imports`
- **Phase 12** — delete `lib/` re-export shims

Each later phase gets its own plan addendum file (`2026-XX-XX-monorepo-phase-N.md`) when we reach it, so we plan with the actual file structure that exists at that point rather than guessing.

---

## Verification Loop (run after every phase)

```bash
pnpm install
pnpm --filter @vibesboard/web type-check
pnpm --filter @vibesboard/web test
pnpm --filter @vibesboard/web build
pnpm --filter vibeagent-functions build
```

If any fails, fix before committing. Each phase ends with a clean tree and a single PR-shaped commit on `feature/monorepo-split`.
