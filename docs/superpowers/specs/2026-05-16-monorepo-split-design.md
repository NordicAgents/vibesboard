# Vibesboard Monorepo Split — Design & Phased Migration

**Status:** Draft for review
**Author:** brainstormed with Claude (Opus 4.7)
**Date:** 2026-05-16
**Branch:** `feature/monorepo-split`

---

## 1. Goal

Turn Vibesboard from a single Next.js app into a **plug-and-play monorepo** where:

- The database, auth provider, AI provider, calendar provider, and inbox channels are all **swappable adapters** behind stable interfaces.
- Business-logic packages (`ai`, `agents`, `scheduling`, `inbox`, `billing`, …) have **zero direct knowledge** of Firebase, OpenAI, Google, or Stripe.
- New features can be added as new packages without touching unrelated code.
- The whole thing (or any subset) can be reused in a different product later — e.g., "just the scheduling package on top of a Supabase adapter."

**Non-goal:** No tooling changes in this effort. We keep pnpm, Next.js, ESLint, Prettier, and the Node test runner. The split is purely structural.

---

## 2. Architecture: Three Layers

The whole design rests on a strict three-layer rule. **Imports flow downward only.**

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3 — apps/*                                           │
│  apps/web (Next.js)   apps/functions (Firebase Functions)   │
│  Wires features + adapters together. Only place that knows  │
│  "Firebase + OpenAI + Google" specifically.                 │
└────────────────────────┬────────────────────────────────────┘
                         │ imports
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 2 — Features (business logic)                        │
│  @vibesboard/auth, agents, ai, retrieval, inbox,            │
│  scheduling, billing, integrations, tenant, ui, utils       │
│  Import ONLY from contracts. Never from adapters.           │
└────────────────────────┬────────────────────────────────────┘
                         │ imports
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 — Adapters (swappable infrastructure)              │
│  @vibesboard/adapter-firebase, adapter-openai,              │
│  adapter-anthropic, adapter-google, adapter-stripe,         │
│  channel-whatsapp, channel-instagram, channel-chatwoot      │
│  Implement contracts. Apps choose which to wire.            │
└────────────────────────┬────────────────────────────────────┘
                         │ imports
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Layer 0 — @vibesboard/contracts                            │
│  Pure TypeScript interfaces + domain types. No runtime      │
│  dependencies. The "API" everyone codes against.            │
└─────────────────────────────────────────────────────────────┘
```

### The Two Inviolable Rules

1. **Feature packages import only from `contracts`.** They never `import { db } from '@vibesboard/adapter-firebase'`. Instead, they receive an `IDataStore` (defined in contracts) via constructor or factory argument.
2. **Feature packages do not import each other directly.** If `agents` needs to call `ai`, it either (a) goes through an interface defined in `contracts`, or (b) the composition happens in the `apps/*` layer. Pragmatic exceptions are allowed but listed in the spec (see §6).

Both rules are enforced by an ESLint `no-restricted-imports` config per package.

---

## 3. Package Inventory

### Layer 0 — Contracts (1 package)

| Package | Purpose |
|---|---|
| `@vibesboard/contracts` | All TypeScript interfaces (`IDataStore`, `IAuth`, `IStorage`, `IAIProvider`, `ICalendarProvider`, `IBilling`, `IInboxChannel`, `ITool`, …) plus pure domain types (`Agent`, `Message`, `TenantContext`, `Plan`, `BookingSlot`, `Conversation`, etc.). Zero runtime deps. |

### Layer 1 — Adapters (7+ packages, one per pluggable thing)

| Package | Implements | Today |
|---|---|---|
| `@vibesboard/adapter-firebase` | `IDataStore`, `IAuth`, `IStorage` | Wraps current `lib/firebase/*` |
| `@vibesboard/adapter-openai` | `IAIProvider` | Wraps `lib/openai.ts` |
| `@vibesboard/adapter-anthropic` | `IAIProvider` | Wraps Anthropic SDK usage |
| `@vibesboard/adapter-google` | `ICalendarProvider`, `IOAuthProvider` | Wraps `lib/google/*` |
| `@vibesboard/adapter-stripe` | `IBilling` | Wraps `lib/stripe*.ts` |
| `@vibesboard/channel-whatsapp` | `IInboxChannel` | Wraps `lib/whatsapp-inbox/*` |
| `@vibesboard/channel-instagram` | `IInboxChannel` | Wraps `lib/instagram-inbox/*` |
| `@vibesboard/channel-chatwoot` | `IInboxChannel` | Wraps `lib/chatwoot/*` |

New adapters (e.g., `adapter-supabase`, `channel-telegram`) can be added later by implementing the same interfaces, with **no change to feature packages**.

### Layer 2 — Features (11 packages)

| Package | Responsibility | Key dependencies |
|---|---|---|
| `@vibesboard/utils` | Pure helpers (fetch-with-retry, sanitize, date math). No I/O. | none |
| `@vibesboard/tenant` | Multi-tenant context, workspace isolation primitive | contracts |
| `@vibesboard/auth` | Sign-in/sign-up flows, RBAC, session | contracts, tenant |
| `@vibesboard/ai` | Agent runtime, tool execution, completion loop | contracts |
| `@vibesboard/agents` | Agent CRUD, hooks, permissions, notifications | contracts, ai (via interface) |
| `@vibesboard/retrieval` | RAG, embeddings, file indexing | contracts |
| `@vibesboard/inbox` | Channel-agnostic inbox engine, message storage, routing | contracts |
| `@vibesboard/scheduling` | Calendar logic, availability, bookings, booking enquiries | contracts |
| `@vibesboard/billing` | Usage metering, quota enforcement, plans | contracts |
| `@vibesboard/integrations` | Generic integration registry, agent-links | contracts |
| `@vibesboard/ui` | Shared React components | none (peer: react) |

### Layer 3 — Apps (2 packages today)

| App | Purpose | Wires |
|---|---|---|
| `apps/web` | Next.js dashboard + public widget + landing | All features + chosen adapters |
| `apps/functions` | Firebase Cloud Functions (storage trigger, auth trigger) | Subset: retrieval, agents, adapter-firebase |

---

## 4. Repository Layout

```
baku/
├── apps/
│   ├── web/                      # current Next.js app moves here
│   │   ├── app/                  # Next.js app router
│   │   ├── components/           # app-specific components
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── functions/                # current functions/ moves here
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── contracts/
│   │   └── src/
│   │       ├── domain/           # Agent, Message, TenantContext, …
│   │       ├── ports/            # IDataStore, IAIProvider, …
│   │       └── index.ts
│   ├── utils/
│   ├── tenant/
│   ├── auth/
│   ├── ai/
│   ├── agents/
│   ├── retrieval/
│   ├── inbox/
│   ├── scheduling/
│   ├── billing/
│   ├── integrations/
│   ├── ui/
│   ├── adapter-firebase/
│   ├── adapter-openai/
│   ├── adapter-anthropic/
│   ├── adapter-google/
│   ├── adapter-stripe/
│   ├── channel-whatsapp/
│   ├── channel-instagram/
│   └── channel-chatwoot/
├── package.json                  # pnpm workspaces root
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── …
```

### Per-package shape

Every package follows the same minimal shape (matches the otto-monorepo reference):

```
packages/<name>/
├── src/
│   └── index.ts          # public API barrel
├── package.json
└── tsconfig.json
```

`package.json` template:

```json
{
  "name": "@vibesboard/<name>",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

No build step — TypeScript source is consumed directly via `tsconfig` paths. This matches the otto reference and avoids the overhead of building each package on every change.

---

## 5. Interface Contracts (sketch)

These are illustrative — exact shapes get pinned down in Phase 1.

```ts
// @vibesboard/contracts/ports/data-store.ts
export interface IDataStore {
  collection<T>(name: string): ICollection<T>;
  transaction<T>(fn: (tx: ITx) => Promise<T>): Promise<T>;
}

// @vibesboard/contracts/ports/ai-provider.ts
export interface IAIProvider {
  complete(req: CompletionRequest): AsyncIterable<CompletionChunk>;
  embed(text: string): Promise<number[]>;
}

// @vibesboard/contracts/ports/calendar-provider.ts
export interface ICalendarProvider {
  listAvailability(account: AccountRef, range: TimeRange): Promise<Slot[]>;
  book(account: AccountRef, slot: Slot, meta: BookingMeta): Promise<BookingRef>;
}

// @vibesboard/contracts/ports/inbox-channel.ts
export interface IInboxChannel {
  readonly id: string;                       // "whatsapp" | "instagram" | …
  handleWebhook(req: WebhookRequest): Promise<InboundMessage[]>;
  sendMessage(account: AccountRef, msg: OutboundMessage): Promise<void>;
}

// @vibesboard/contracts/ports/billing.ts
export interface IBilling {
  recordUsage(tenant: TenantId, kind: UsageKind, amount: number): Promise<void>;
  getQuota(tenant: TenantId): Promise<QuotaState>;
}
```

Feature packages declare their dependencies in **constructors** or **factory functions**:

```ts
// @vibesboard/ai
export function createAgentRuntime(deps: {
  ai: IAIProvider;
  store: IDataStore;
  billing: IBilling;
}) { … }
```

The `apps/*` layer is the only place where adapters get instantiated and wired:

```ts
// apps/web/lib/composition-root.ts
import { firebaseDataStore } from '@vibesboard/adapter-firebase';
import { openAIProvider } from '@vibesboard/adapter-openai';
import { stripeBilling } from '@vibesboard/adapter-stripe';
import { createAgentRuntime } from '@vibesboard/ai';

export const runtime = createAgentRuntime({
  ai: openAIProvider(env.OPENAI_KEY),
  store: firebaseDataStore(env.FIREBASE_CONFIG),
  billing: stripeBilling(env.STRIPE_KEY),
});
```

---

## 6. Pragmatic Exceptions

Some cross-feature coupling is real and shouldn't be hidden behind ceremony:

1. **`agents` → `ai`**: agents CRUD needs to invoke the runtime to test agents. Allowed via a thin `IAgentRuntime` interface in `contracts`, not a direct package import.
2. **`inbox` → `agents`**: inbox dispatches messages to agents. Allowed via `IAgentDispatcher` in `contracts`.
3. **`scheduling` is genuinely independent** of `ai`/`agents` — no cross-imports needed.
4. **`billing` is consumed everywhere** via the `IBilling` interface — meter-call sites are in feature packages but always go through the injected interface.

Any new exception must be added to this list with justification before merge.

---

## 7. Phased Migration Plan

The migration is **strictly additive** until the very last phase. Each phase ends with a working app, green tests, and a verification checklist. **No phase deletes code until its replacement has been live for at least one phase.**

### Phase 0 — Workspace skeleton (low risk, ~half a day)

**Do:**
- Add `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
- Move current Next.js code into `apps/web/` (just folder rename, no logic changes). Update root scripts to delegate.
- Move current `functions/` into `apps/functions/`.
- Add `tsconfig.base.json` with shared compiler options; per-package tsconfigs extend it.
- Create empty `packages/contracts/` with a placeholder `index.ts`.

**Verification:**
- `pnpm install` succeeds at root.
- `pnpm --filter @vibesboard/web dev` boots the app.
- `pnpm --filter @vibesboard/web build` succeeds.
- All existing tests pass (`pnpm --filter @vibesboard/web test`).
- Firebase Functions deploy still works from `apps/functions/`.

**Rollback:** revert the single PR — purely a folder rename.

---

### Phase 1 — Extract contracts (low risk, 1 day)

**Do:**
- Move pure type definitions from `lib/firestore-types.ts`, `lib/types.ts`, `lib/types/message.ts`, `lib/permissions-core.ts`, and `lib/tenant-context.ts` (just the types, not the implementations) into `@vibesboard/contracts/src/domain/`.
- Define initial port interfaces in `@vibesboard/contracts/src/ports/`: `IDataStore`, `IAuth`, `IStorage`, `IAIProvider`, `ICalendarProvider`, `IBilling`, `IInboxChannel`. Start minimal — only what current code already uses.
- Convert the old type files into thin shims that re-export from contracts so existing imports keep working unchanged: replace the body of `lib/firestore-types.ts` with `export type * from '@vibesboard/contracts';` (and similar for the others). The shims stay in place until Phase 12.

**Verification:**
- `pnpm typecheck` passes across the whole monorepo.
- `pnpm --filter @vibesboard/web test` passes unchanged.
- A spot-check: pick five random files in `lib/` and `app/` and confirm their imports still resolve.

**Rollback:** delete `packages/contracts/`, restore the original type files. Re-exports make the change non-invasive.

---

### Phase 2 — Extract pure utility packages (low risk, ~half a day)

**Do:**
- Move `lib/utils/*` → `@vibesboard/utils`. These have no I/O and few dependents.
- Move `lib/tenant-context.ts` runtime code (types already in contracts) → `@vibesboard/tenant`.
- Update imports throughout `apps/web` and `apps/functions` to point at the new packages.

**Verification:**
- `pnpm typecheck` + `pnpm test` green.
- App boots; tenant-scoped routes (`/[tenantSlug]/…`) load correctly in dev.

**Rollback:** restore `lib/utils/` and `lib/tenant-context.ts`; revert import changes.

---

### Phase 3 — Wrap Firebase as the first adapter (medium risk, 1-2 days)

This is the **proof of concept** for the adapter pattern. Get one adapter right and the rest are mechanical.

**Do:**
- Create `@vibesboard/adapter-firebase` that wraps current `lib/firebase/*` exports.
- Inside the adapter, expose factories that **return objects implementing the `IDataStore`/`IAuth`/`IStorage` ports** from contracts.
- Keep the old `lib/firebase/*` files as thin re-exports of the adapter package, so existing call sites in `apps/web` and feature code (still in `lib/`) keep working.
- Wire `apps/web` and `apps/functions` to use the adapter explicitly in one place (`composition-root.ts`).

**Verification:**
- Full smoke test in dev:
  - Sign in as a test user.
  - Create an agent in a workspace.
  - Send a chat message and confirm response.
  - Upload a file and confirm it gets indexed.
- Firebase Functions trigger (file upload → ingest) fires correctly.
- All existing tests pass.

**Rollback:** delete `adapter-firebase`, restore direct `lib/firebase/*` imports.

---

### Phase 4 — Wrap AI providers as adapters (medium risk, 1 day)

**Do:**
- Create `@vibesboard/adapter-openai` and `@vibesboard/adapter-anthropic`. Each exposes a factory returning an `IAIProvider`.
- Old `lib/openai.ts` and `lib/openai-compat.ts` become re-exports of the adapter package.
- `composition-root.ts` in `apps/web` picks which adapter to wire based on config.

**Verification:**
- Chat completion works against both providers in dev (switch model from UI).
- Streaming responses arrive correctly.
- Embedding generation (used by retrieval) still works on a re-upload test.
- Tool calls fire correctly through the runtime.

**Rollback:** revert adapter packages, restore direct SDK usage.

---

### Phase 5 — Wrap Google and Stripe as adapters (low-medium risk, 1 day)

**Do:**
- `@vibesboard/adapter-google` wraps `lib/google/*`, exposes `ICalendarProvider` and `IOAuthProvider`.
- `@vibesboard/adapter-stripe` wraps `lib/stripe*.ts`, exposes `IBilling`.
- Re-exports from old locations.

**Verification:**
- Calendar OAuth flow completes end-to-end.
- A test booking creates a Google Calendar event.
- Stripe webhook still records usage correctly (test event via Stripe CLI).
- Quota enforcement still triggers when over plan limit.

**Rollback:** revert per adapter.

---

### Phase 6 — Extract `ai` and `agents` features (high risk, 2-3 days)

This is the hardest phase because `agent/` is the biggest module (~40 files) and has the most fan-in. Do it in two sub-steps.

**Phase 6a — extract `@vibesboard/ai`:**
- Move `lib/agent/*` runtime code into `@vibesboard/ai`.
- Refactor: every direct `firebase`/`openai` import becomes a constructor-injected dependency (typed against contracts).
- Old `lib/agent/*` paths become re-exports.

**Verification (6a):**
- Full agent conversation test in dev (multi-turn, with tool calls).
- Streaming works.
- Tool execution works (calendar lookup, RAG retrieval).
- Existing unit tests in `lib/agent/*.test.ts` migrated to new package, pass.

**Phase 6b — extract `@vibesboard/agents`:**
- Move `lib/agents/*` (CRUD + hooks + permissions + notifications) into `@vibesboard/agents`.
- Direct calls into `lib/agent/handoff` get refactored to go through `IAgentRuntime` from contracts.
- Old `lib/agents/*` paths become re-exports.

**Verification (6b):**
- Create / edit / delete agent works in the UI.
- Permissions check correctly enforces tenant isolation.
- Agent hooks fire on the right events.
- All existing tests pass.

**Rollback:** revert sub-phase independently.

---

### Phase 7 — Extract `retrieval` (low-medium risk, 1 day)

**Do:**
- Move `lib/retrieval/*` → `@vibesboard/retrieval`. Depends on `IDataStore`, `IStorage`, `IAIProvider` (for embeddings).
- Old paths become re-exports.

**Verification:**
- Upload a new document; confirm it's chunked and embedded.
- Ask an agent a question that requires retrieval; confirm grounded answer.
- Re-indexing existing docs still works.

**Rollback:** revert.

---

### Phase 8 — Extract inbox and channels (medium risk, 2 days)

**Do:**
- Move `lib/inbox-agent/*` core dispatcher → `@vibesboard/inbox`. Define `IInboxChannel` more concretely.
- Move `lib/whatsapp-inbox/*` → `@vibesboard/channel-whatsapp` (implements `IInboxChannel`).
- Move `lib/instagram-inbox/*` → `@vibesboard/channel-instagram`.
- Move `lib/chatwoot/*` → `@vibesboard/channel-chatwoot`.
- `apps/web` registers channels with the inbox engine at startup.

**Verification:**
- Send a WhatsApp message to a test number; confirm agent reply.
- Same for Instagram.
- Webhook-style channel (Chatwoot) routes correctly.
- Storage of inbound messages still works.

**Rollback:** revert per channel.

---

### Phase 9 — Extract scheduling, billing, integrations (medium risk, 1-2 days)

**Do:**
- Move `lib/scheduling/*` + `lib/booking-enquiries/*` → `@vibesboard/scheduling`.
- Move `lib/stripe*.ts` runtime + `lib/usage*.ts` + `lib/plans.ts` → `@vibesboard/billing`.
- Move `lib/integration/*` + `lib/agent-links/*` → `@vibesboard/integrations`.
- All retain re-exports.

**Verification:**
- Booking flow end-to-end in dev (request → availability → confirm).
- Usage events recorded; over-quota requests blocked.
- Public widget link (agent-link) loads and chats correctly.

**Rollback:** revert per package.

---

### Phase 10 — Extract `auth` and `ui` (low risk, 1 day)

**Do:**
- Move auth-related code (sign-in/sign-up server actions, RBAC enforcement) → `@vibesboard/auth`.
- Move shared `components/` (the truly reusable subset, not app-specific) → `@vibesboard/ui`. Keep app-specific components in `apps/web/components/`.

**Verification:**
- Sign-in, sign-up, sign-out, password reset all work.
- Tenant-scoped pages render correctly.

**Rollback:** revert.

---

### Phase 11 — Enforce the import rules (low risk, half a day)

**Do:**
- Add per-package ESLint config with `no-restricted-imports`:
  - Feature packages: forbid any import that starts with `@vibesboard/adapter-` or `@vibesboard/channel-`.
  - Feature packages: forbid imports from other feature packages except the documented exceptions (§6).
- Add a CI step that runs `pnpm lint` on every package.

**Verification:**
- CI fails if a developer accidentally imports an adapter from a feature package (test by intentionally adding a bad import on a throwaway branch).

**Rollback:** drop the ESLint rules.

---

### Phase 12 — Delete the `lib/` re-export shims (low risk, half a day)

**Do:**
- Now that everything is migrated and all imports resolve through `@vibesboard/*`, do a final repo-wide find-replace to remove all imports from `lib/*`.
- Delete the `lib/` directory entirely.

**Verification:**
- `pnpm typecheck` + `pnpm test` + `pnpm build` all green.
- Full smoke test of the app: sign in, agent chat, file upload, booking, billing, inbox messages.
- Deploy to staging (`dev` branch) and verify.

**Rollback:** if anything breaks, restore `lib/` from git history. Because each prior phase kept `lib/` re-exports working, the only risk here is a missed import — which `pnpm typecheck` catches immediately.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Circular package deps** appearing as features get extracted | The layering rule prevents it by construction. ESLint catches accidental violations. |
| **`firestore-types.ts` is huge (941 LOC) and imported everywhere** — extracting it might cause hundreds of broken imports | Phase 1 keeps the file as a re-export shim. The actual change is a one-line `export * from '@vibesboard/contracts';`. No call site needs to update. |
| **`agent/handoff` → `agents/server` coupling** | Address in Phase 6b by introducing `IAgentRuntime` in contracts. Documented exception. |
| **Firebase Functions has its own bundling** — workspace deps might confuse the Functions build | Test Functions deploy in Phase 0 explicitly. If issues arise, use `pnpm deploy` to materialize a flat tree for the Functions sub-app. |
| **Tests in `lib/**/*.test.ts` reference local imports** | Move tests with their code. Verification gate at each phase ensures tests pass before moving on. |
| **Long-running migration → main diverges, merge conflicts** | Each phase is a single PR, mergeable in 1-2 days. Land them in sequence on `dev`. |
| **A phase introduces a regression that's hard to isolate** | Each phase has an explicit rollback. Each phase is independently revertable because earlier phases left re-export shims in place. |

---

## 9. Success Criteria

The migration is "done" when **all** of these hold:

1. `lib/` is gone.
2. Every business-logic file in `packages/*` (Layer 2) has zero imports of Firebase, OpenAI, Anthropic, Google, or Stripe SDKs.
3. Adding a new adapter (e.g., `@vibesboard/adapter-supabase`) requires changes only in:
   - the new adapter package itself, and
   - `apps/web/composition-root.ts` (one line).
4. `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm lint` all pass in CI.
5. A new contributor can read `packages/<any>/src/index.ts` and understand its dependencies from the constructor signatures alone.

---

## 10. Out of Scope

- Tooling migration (bun, biome, changesets, knip). Possible follow-up; not part of this effort.
- Per-package versioning / publishing to a registry. Everything stays `private: true`.
- Rewriting any business logic. The migration is move-and-rewire only.
- Multi-region deployment changes.
- Adding new providers (Supabase, Anthropic-only mode, Telegram channel). The point of this work is to *make those easy later*, not to do them now.

---

## 11. Open Questions

None at time of writing. Surface as they come up during Phase 0.
