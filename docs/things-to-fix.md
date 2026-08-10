# Things to fix

The actionable findings from the E2E hardening pass were resolved on
2026-08-10. `docs/e2e-audit-findings.md` remains the raw audit; this file now
records the shipped resolution and the boundaries that still require real
external services.

## Resolved — P1 correctness

- Agent deletion removes every file's vector rows transactionally before the
  agent/file rows are deleted. Storage cleanup remains best-effort after commit.
- Browser ingestion returns `422` and marks the file failed when zero searchable
  chunks are produced; thrown ingestion errors also persist a failed state.
- Re-embedding counts only files that produced searchable chunks and reports
  zero-chunk results as errors.
- The Knowledge file list loads from `GET /api/agents/[id]/files`, checks delete
  responses, refreshes from the server after deletion, and falls back to a
  truthful local removal if that refresh is temporarily unavailable.

## Resolved — P2 hardening

- Canonical UUID validation now lives in `@vibesboard/utils` and guards the
  agent/tenant lookups that compare values with Postgres UUID columns.
- Tenant network policy is resolved centrally before every tenant provider model
  is built, closing the sibling SSRF-policy bypasses.
- Upload URLs require a positive file size no greater than 10 MB. The exact
  content length is part of the signed PUT request.
- Migration `0025_lyrical_sugar_man.sql` removes legacy duplicate file rows and
  orphaned duplicate embeddings, then adds a unique
  `(agent_id, file_key)` index. File insertion now upserts against it.
- MIME policy and the upload-size limit are shared between both upload routes.
- Existing-agent uploads accept only file metadata; the server mints the
  canonical tenant/agent file key and the client trusts the returned key.
- File-row deletion is encapsulated in `files-store.ts` and used by the
  transactional delete route.
- Access-gate passwords use a random per-record salt in a versioned format;
  verification remains compatible with legacy unsalted hashes.
- API validation issues, including field paths, are surfaced in agent-form
  errors.
- Personal workspaces no longer render the Google Review tab.

## Resolved — P3 accessibility and UX

- Icon-only allowlist, feedback, external-link, and tenant-copy controls now
  have accessible names.
- Agent name/instructions and Tenant ID inputs have associated labels.
- Unknown or unavailable agent dashboard tabs fall back to Setup.
- Version history and the admin file monitor render persistent retryable error
  states instead of relying only on toasts.
- The chat-draft create action has a distinct accessible name from the preview
  create action.
- Error toasts use `role="alert"`/assertive announcements; non-errors retain
  `role="status"`/polite announcements.
- Agent pages and the share API use one canonical share-URL builder.

## Resolved — regression coverage

- Added route coverage for transactional file deletion, zero-chunk ingestion,
  re-embedding, canonical/size-bound upload signing, and agent deletion cleanup.
- Added database coverage for the unique file upsert and store-level delete.
- Added response-boundary coverage proving that both agent list and detail APIs
  return only `hasAccessPassword`, never an access-password hash.

## Blocked — requires real external services

These are environment boundaries rather than local code defects:

- Real model reply quality, tool-choice correctness, and retrieval relevance.
  CI uses the deterministic OpenAI network stub, so `chunksInserted` and
  `embeddingProvider` remain the honest local proxies.
- Google Calendar OAuth, WhatsApp/Instagram webhooks, MCP servers, and email
  delivery require real credentials or inbound callbacks.
- The full sign-up happy path creates permanent users and personal tenants, so
  the suite continues to cover it indirectly through duplicate-email behavior.
- Forgot-password behavior depends on the machine's independently loaded
  `RESEND_API_KEY`.

## Verification

- `bun run db:migrate`
- `bun run test` — 1,547 passed, 11 skipped
- `bun run type-check`
- `bun run lint` — 0 errors (pre-existing warnings remain)
- `bun run format:check`
- `bun run build`
