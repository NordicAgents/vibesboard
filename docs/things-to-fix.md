# Things to fix

Open work left over from the E2E hardening pass. Companion to
`docs/e2e-audit-findings.md` (the raw audit) — this file is the short, ordered
list of what is actually still broken.

**Confidence labels.** Every item says how it was established:

- **[verified]** — read in the current source and confirmed by hand.
- **[reported]** — raised by an agent with a file:line citation, not
  independently re-checked. Confirm before acting.

---

## P1 — Same class of bug as ones already fixed

Three defects survived the fixes because each lives in a file the fixing agent
was not allowed to touch. They are the same two families as the bugs already
closed (orphaned embeddings, silent zero-chunk success), so the reasoning behind
those fixes applies unchanged.

### 1. Deleting an agent orphans its embeddings forever **[verified]**

`apps/web/app/api/agents/[id]/route.ts` (DELETE) removes the S3 objects and the
agent row, relying on FK cascade. `files` does cascade from `agents`
(`packages/adapter-postgres/src/schema/files.ts`), but the embedding tables have
**no foreign key to `files`** — `sourceId` is a bare
`uuid('source_id').notNull()` with no `.references()`
(`packages/adapter-postgres/src/schema/vectors.ts:28,57`). Deleting an agent
therefore leaves every `file_chunk` row for it in the vector store permanently;
only deleting the whole tenant cascades them away.

Fix: delete embeddings for the agent's file ids before deleting the agent (mirror
what `files/delete/route.ts` now does), **or** add the FK with
`ON DELETE CASCADE` plus an index on `sourceId`. The FK is the durable fix; the
explicit delete is the safe one to ship first.

### 2. The ingest route repeats the zero-chunk bug **[verified]**

`packages/ai/src/file-processor.ts` now refuses to mark a file `indexed` when
`chunksInserted === 0`, but `apps/web/app/api/agents/[id]/files/ingest/route.ts`
calls `ingestFileForAgent` and never checks the returned count. That is the path
the browser actually uses (upload → PATCH fileKeys → ingest), so the
user-visible bug is still live: an expired embedding key or a quota error
produces a file that looks successfully indexed and retrieves nothing.

Fix: apply the same `chunksInserted` check. Better, make it impossible to forget
— give `ingestFileForAgent` a discriminated result type so ignoring the failure
case is a type error.

### 3. `reembed` counts failures as successes **[reported]**

`apps/web/app/api/agents/[id]/reembed/route.ts:45-59` increments `reembedded++`
after every `ingestFileForAgent` call that does not throw, so zero-chunk results
are reported as re-embedded. Same root cause as #2.

### 4. The file list lies after a failed delete **[reported]**

`apps/web/components/agents/tools-files-manager.tsx:339-355` (`handleFileDelete`)
does not check `res.ok`. On a 500 it still removes the row locally and shows
"File deleted successfully". Now that the server strips `fileKeys` itself, the
follow-up `PATCH` there is also redundant, and the list should re-render from
`GET /api/agents/[id]/files` rather than `agent.fileKeys`.

---

## P2 — Hardening and consistency

Not user-visible failures, but each is a place the same bug can grow back.

- **Unguarded uuid lookups elsewhere** **[reported]** — `getAgentById` now
  rejects non-uuid ids, but `getAgentForMember` / `getAgentForUser`
  (`packages/agents/src/server.ts`) and other id-keyed lookups still interpolate
  straight into uuid comparisons, so a malformed id is a Postgres 22P02 (500)
  rather than a 404. `isUuid` is now duplicated in three places
  (`packages/agents/src/server.ts`, `packages/agents/src/conversations.ts:19`,
  `apps/web/lib/tenant-context.ts`) — extract one.
- **SSRF guard still bypassed at three sibling call sites** **[reported]** — the
  `llm-configs/[id]/test` route now passes tenant network options to
  `buildProviderModel`, but three other call sites do not, so a tenant that
  allowlisted a private host still fails there.
- **No server-enforced upload size cap** **[reported]** — the 10 MB limit exists
  only in the browser (`tools-files-manager.tsx`); a presigned PUT has none.
- **No unique constraint on `files (agent_id, file_key)`** **[reported]** — only
  non-unique indexes, so a re-uploaded key can produce several rows. The delete
  route handles duplicates defensively; a unique index would make the invariant
  real.
- **`ACCEPTED_MIME_TYPES` duplicated** across
  `app/api/files/upload-url/route.ts` and
  `app/api/agents/[id]/files/upload-url/route.ts` — extract to a shared module.
- **Legacy `${userId}/` key prefix** — `agents/[id]/files/upload-url` still
  accepts it because the Knowledge tab mints keys client-side. Migrate the client
  to use the returned `fileKey`, then delete that branch (marked in the file).
- **`files-store.ts` has no delete helper** — the delete route reaches into the
  schema directly. Add `deleteFilesByKey(agentId, fileKey, db)` so no other call
  site can repeat the S3-only delete.
- **Access-gate hash is unsalted HMAC-SHA256 under one process-wide secret**
  **[reported]** (`packages/ai/src/access-gate-crypto.ts`) — identical passwords
  produce identical bytes across every agent and tenant. The hash is no longer
  exposed, but the scheme itself should be per-agent salted.
- **Toast copy is the only failure signal** — `use-agent-form.ts:206-207` reads
  only `error.error`, so the new 400 bodies' `issues` array is discarded and the
  user sees "Invalid input" with no field named.
- **Personal workspaces still see the Google Review tab** **[reported]** —
  `app/settings/tenant/page.tsx:362,495` gates it on `googleReviewEnabled` only,
  not on `isPersonal`.

---

## P3 — Accessibility and UX polish

Triaged as worth doing; none are urgent. Full detail in
`docs/e2e-audit-findings.md`.

| Where | What |
| --- | --- |
| `settings/tenant/llm-providers` | allowlist chip's remove button is icon-only with no accessible name |
| `components/agents/public-agent-experience.tsx` | thumbs-up/down feedback buttons have no accessible name |
| `components/agents/agent-share-tab.tsx` | icon-only external-link button has no `aria-label` |
| `components/agents/agent-setup-tab.tsx` | name/instructions fields have no `<label>`; the placeholder is doing double duty |
| `app/admin/tenants/[id]/tabs/overview-tab.tsx` | "Tenant ID" `Label` has no `htmlFor`, the `Input` no `id` |
| `components/agents/agent-dashboard-tabs.tsx` | `isTabAvailable()` returns true for unknown values, so `?tab=zzz` renders an empty tab bar instead of falling back |
| `components/agents/agent-version-history-tab.tsx` | a failed `/versions` fetch renders the same empty state as a genuinely empty list |
| `components/admin/admin-file-monitor.tsx` | fetch failures surface only as a toast, never in the DOM |
| `components/agents/agent-creator-chat.tsx` | two buttons named exactly "Create Agent" once a draft exists |
| `app/layout.tsx` | every toast carries `role="status"`, success and error alike — no way to distinguish them |
| `lib/share-url.ts` (new) | the canonical share-URL builder is duplicated between the share route and the agent page |

---

## Blocked — not testable in this environment

Not a backlog so much as a boundary. None of these can be verified locally or in
CI as currently set up:

- **Real model quality** — the suite stubs the model at the network boundary
  (`e2e/mock-openai.mjs`: one canned sentence, one fixed 1536-dim vector). Reply
  quality, tool-choice correctness and retrieval *relevance* are all unassertable.
  `chunksInserted` and `embeddingProvider` are the honest proxies for "it was
  embedded".
- **Google Calendar OAuth, WhatsApp / Instagram webhooks, MCP servers, email
  delivery** — all need real credentials or inbound callbacks.
- **The sign-up happy path** — every real sign-up creates a permanent user plus an
  auto-provisioned personal tenant, and nothing deletes personal tenants. Covered
  indirectly via better-auth's duplicate-email response instead.
- **Forgot-password submission** — behaviour depends on `RESEND_API_KEY`, which
  `next dev` reads independently of the Playwright env, so the outcome differs
  per machine.

---

## Housekeeping

- `docs/e2e-audit-findings.md` cites some line numbers that have since shifted
  (e.g. `patchAgentSchema.parse` in `app/api/agents/[id]/route.ts`). Treat its
  line references as approximate.
- No test file exists for `app/api/agents/[id]/files/delete/` despite it now
  doing transactional multi-table work.
- Regression coverage worth adding centrally: assert that `GET /api/agents` and
  `GET /api/agents/[id]` responses contain no `accessPassword` key.
