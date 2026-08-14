# Pre-Release QA Report — 2026-08-13

Full-application QA pass against `dev.vibesboard.com` (staging), run ahead of the first public release. Performed as a normal end user / workspace admin / super-admin would use the product, via real browser automation (no mocking), against the live staging deployment and its Postgres/MinIO-backed staging data.

## Executive summary

- **113 features inventoried** across 7 subsystems (from source + the existing Playwright e2e suite).
- **25 end-to-end use cases** designed to cover golden paths, admin/super-admin flows, security/tenant-isolation, and edge cases; **25/25 executed** (24 via a multi-agent browser-automation workflow, 1 by hand after the automation tooling died mid-run — see *Methodology*).
- Every non-passing result was **adversarially re-verified by reading the actual source code** (not re-trusting the browser agent's own read of the UI), to separate real defects from test artifacts.
- **1 CRITICAL bug, confirmed against source**: the Knowledge Base file upload is **completely non-functional** on staging — every upload fails due to a missing CORS policy on the storage bucket. RAG/knowledge base is a headline feature; this blocks it entirely. **Production was subsequently confirmed affected by the same defect, and both buckets have since been fixed — see [Update 2026-08-14](#update-2026-08-14--critical-file-upload-bug-resolved).**
- **1 MEDIUM bug, confirmed against source**: the agent History tab shows a stale "Current version" badge immediately after a Setup save or a Restore, until a full page reload. **Fixed — see [Update 2026-08-14 (2)](#update-2026-08-14-2--medium-bug-and-every-minor-finding-resolved).**
- Feature discovery also flagged that **MCP (Model Context Protocol) server support** — listed in the working tree checked out at the start of this session (`chore/pre-flip-fixes`) — had no backing implementation anywhere in the codebase. **Cross-checked directly against `origin/dev` (this PR's actual target): the claim has already been removed** from the public landing page copy and from `CLAUDE.md`/`AGENTS.md` on `dev`. No action needed there — noted only so the discrepancy doesn't cause confusion. The related "unified inbox" phrasing (marketing term for two separate WhatsApp/Instagram UIs, not an actual merged view) is still present on `dev` and is a much smaller, optional copy nit — see *Feature inventory*.
- **3 other findings investigated and cleared** (not real bugs — a test-timing artifact, an intentionally-off feature flag, and an intentional API design decision). Full detail below so nothing is silently dropped.
- **2 minor, unverified-but-credible UX bugs** worth a ticket (an incorrect "no admin access" banner shown to a user who does have access; a dark-mode toggle that's mislabeled for first-time visitors whose OS is already in dark mode). **Both fixed, along with two more findings surfaced later in the same pass — see [Update 2026-08-14 (2)](#update-2026-08-14-2--medium-bug-and-every-minor-finding-resolved).**
- No tenant-isolation, security, or data-corruption issues were found. Multi-tenant scoping, access gates, invite codes, RLS-backed workspace isolation, and the admin delete-confirmation safety gate all worked correctly.

**Recommendation (as written 2026-08-13): hold public launch until the CRITICAL file-upload bug is fixed, and the fix is confirmed on both the staging and production storage buckets.** Everything else found is real but non-blocking.

**This condition has since been met — see [Update 2026-08-14](#update-2026-08-14--critical-file-upload-bug-resolved).**

## Update 2026-08-14 — CRITICAL file-upload bug resolved

The report's own recommendation was to check production for the same defect. That check was run, and the finding was worse than the report could confirm at the time:

| Bucket | CORS before | CORS after |
| --- | --- | --- |
| `gs://vibesboard-staging-files` | empty | applied, preflight verified |
| `gs://vibesboard-prod-files` | **empty — production was equally broken** | applied, preflight verified |

Knowledge Base upload was non-functional in **production**, not just staging. The report could only observe staging and correctly flagged prod as needing an immediate check; that check confirmed it.

Note the prod bucket is `vibesboard-prod-files`, not the older `vibeagent-files`. That rename is the likely mechanism: the go-public infrastructure work provisioned new buckets, and the manual CORS step was never re-applied to either — exactly the "provision bucket → forget CORS" gap the report predicted.

**Applied to both buckets:**

```json
[
  {
    "origin": ["<the environment's app origins>"],
    "method": ["GET", "HEAD", "PUT"],
    "responseHeader": ["Content-Type", "ETag"],
    "maxAgeSeconds": 3600
  }
]
```

Origins were taken from the live `NEXT_PUBLIC_APP_URL` on each Cloud Run service rather than assumed — staging: `https://dev.vibesboard.com`; production: `https://www.vibesboard.com` plus the apex `https://vibesboard.com`; each environment's `*.run.app` URL included as a fallback.

This is deliberately narrower than the template in [`deployment.md`](../deployment.md), which is an illustrative example rather than a tested policy:

- `POST`/`DELETE` dropped — the browser only ever issues `PUT` (`tools-files-manager.tsx`, `agent-creator-chat.tsx`); deletions are server-side.
- `Authorization` dropped — presigned V4 URLs carry the signature in the query string, so that header is never sent. `ETag` exposed instead.
- No `localhost` origin on either bucket — local development uses MinIO, and permitting localhost against a production bucket would be a genuine weakness.

**Verification:** the exact preflight a browser issues (`OPTIONS` + `Access-Control-Request-Method: PUT` + `Access-Control-Request-Headers: content-type`) returns `access-control-allow-origin` for staging, prod-www, and prod-apex. An unlisted origin receives no `access-control-allow-origin` header, confirming the policy is scoped rather than permissive. This verifies the transport layer; a full round-trip upload through the UI is still worth confirming by hand.

**Still open — the recurrence risk is unchanged.** Nothing in the deploy pipeline applies this policy: `cors.json` was removed from the repository during the pre-public cleanup, leaving only prose in `deployment.md`. The next bucket rename or migration will silently break uploads again in exactly the same way. Automating the CORS step in the deploy workflow is the fix that actually closes this, and remains to be done.

## Update 2026-08-14 (2) — MEDIUM bug and every minor finding resolved

Every remaining item from *Confirmed defects* and *Other findings worth a ticket* has a code fix in this PR now (findings below are preserved as originally recorded; this section adds what actually changed and, in two cases, corrects the record with what the code-level investigation found).

- **MEDIUM — History tab stale "Current" badge: fixed as suggested.** `AgentVersionHistoryTab` (`agent-version-history-tab.tsx`) no longer takes a `currentVersion` prop at all — it now reads `isCurrent` per row directly from its own `GET /api/agents/{id}/versions` response (which already computed it correctly; the client was just discarding the field). The stale RSC-drilled prop and its now-dead call-site argument were removed rather than left in place.
- **`/settings/tenant` false "no admin access" banner: fixed.** Root cause was sharper than "two disagreeing checks" — `hasTenantAdminAccess()` and `getManageableTenants()` (which drive the settings-layout banner and the workspace-switcher list) only ever checked the user's **per-tenant** `tenant_members.role`, never the **platform** `users.isSuperAdmin` flag that `requireSuperAdmin()` (used by the actual `/api/tenants/[id]/*` routes) checks. A platform super admin who is only a plain `MEMBER` row in a given tenant — exactly `staging-e2e@example.com` on `Invited Staging Org` — could therefore fully read/write that tenant's config via the API while the layout told them they couldn't. Both functions now also return true/include the tenant for a platform super admin, so the UI agrees with what the API already permits. A regression test was added (`permissions.db.test.ts`: *"is true for a platform super admin who only holds MEMBER in their tenant"*).
- **Dark-mode toggle mislabeled for OS-dark first-time visitors: fixed.** `ThemeToggle` (`theme-toggle.tsx`) computed its label/icon and its click target from `next-themes`' `theme` — the raw, unset-until-an-explicit-choice preference (`'system'` by default, per this app's `defaultTheme="system"`) — instead of `resolvedTheme`, which always reflects what's actually rendered including the OS `prefers-color-scheme` fallback. That's exactly why clicking it on a first visit with a dark OS produced an explicit `'light'` theme: `theme === 'light' ? 'dark' : 'light'` fell through to `'light'` whenever `theme` was anything other than the literal string `'light'`. Now derives everything from `resolvedTheme`.
- **Admin → Tenant → Branding "Live Preview" desync: real bug, different mechanism than first described.** No `#aabbcc`/`#ddeeff` (or any other hardcoded swatch) exists anywhere in the app's source — that string only appears in an unrelated hex-shorthand-normalization test fixture (`colors.test.ts`), so the specific hex values in the original finding look like a misread rather than literal on-page text. What *is* a real, reproducible bug in the same component: `ColorPicker` (`color-picker.tsx`) seeded a local `color` state from its `value` prop **once at mount** and rendered that local state, not the prop, afterward — so whenever the parent's value changed later (the branding tab's own async fetch resolving after first paint, or a "Reset to Defaults" click re-fetching server values), the color-picker swatch/input silently froze on stale data while the Live Preview panel — which reads the parent's state directly — updated correctly. That's a genuine "preview disagrees with the field above it" bug, just the reverse of which side was stale. Fixed by making `ColorPicker` fully controlled (no internal state at all).
- **"Acme Staging Team" showing status "Pending": real bug, and not specific to that one tenant.** `createTeamWorkspace()` (`packages/tenants/src/workspace.ts`, the self-service "New workspace" flow) explicitly inserted every new team tenant with `status: 'pending'` — a leftover from a removed billing-activation gate. Nothing anywhere in this self-hosted build ever transitions a tenant out of `'pending'` (the admin edit endpoint can set it, but only as a manual super-admin action; there's no automatic path). Personal workspaces and admin-created tenants already insert as `'active'`. Net effect: **every team workspace ever created through the normal UI has been permanently stuck showing "Pending,"** not just this one reference tenant — it was simply the only long-lived team workspace this pass happened to inspect closely. Fixed to insert `'active'`, matching the other two creation paths and the column's own schema default. `workspace.test.ts`'s assertion of `'pending'` (which had codified the bug) is now `'active'`. Pre-existing tenants already stuck at `'pending'` in a live database (staging's `Acme Staging Team` included) are unaffected by this code fix and need a one-time manual correction via `/admin/tenants/{id}` edit, or an `UPDATE tenants SET status = 'active' WHERE status = 'pending'`.
- **Agent-creation wizard fields not reacting to programmatic value-setting: confirmed not an app bug, no fix.** The Name field (`agent-builder-form-preview.tsx`) is a textbook fully-controlled input (`value={formData.name}` / `onChange`) with no missing wiring — this matches the report's own suspicion that it was a browser-automation-tooling quirk (React's synthetic `onChange` not firing for a raw `element.value =` assignment that bypasses a real `input` event), not something a typing user, password manager, or autofill would hit.

## Methodology

- Tested as the reusable staging tester account `staging-e2e@example.com` (staging-only credentials, already used by the project's own deep Playwright suite; this account is `super_admin` and a member of 3 workspaces: `Personal`, `Acme Staging Team`, `Invited Staging Org`).
- Work was split into two phases, each orchestrated as a multi-agent workflow:
  1. **Discovery** — 7 parallel agents read the codebase (routes, API handlers, `packages/*`, and the existing `apps/web/e2e/local/` Playwright specs) to build a ground-truth feature inventory, then one agent synthesized it into 25 concrete, self-contained use cases.
  2. **Execution** — each use case was run **strictly one at a time** against a real Chrome instance via the `chrome-devtools` MCP (deliberately not parallel — all browser agents share one live browser session, and concurrent tool calls would race on which page is "selected"). Every agent captured console errors, failed network requests, and screenshots on failure.
- Every use case that didn't cleanly pass was then handed to a **separate agent whose only job was to find and read the actual implementing source code** and independently judge whether it's a real, reproducible defect — explicitly to catch the case where the testing agent misjudged the UI.
- **Tooling failure, handled and disclosed rather than hidden:** the `chrome-devtools` MCP server crashed/disconnected after ~3.75 hours and ~22 completed use cases (retries confirmed it was an infrastructure stall, not a test-content problem — identical empty transcripts on all 6 retry attempts). The run was resumed from cache (no re-testing of already-completed cases), which recovered 2 more before the server disconnected outright. The 25th (mobile-viewport responsiveness) was completed by hand using a second browser-automation tool (`claude-in-chrome`) once the primary one was confirmed dead.
- **Safety constraints honored throughout:** no pre-existing tenant, agent, or conversation was mutated or deleted; all new test data is prefixed `QATEST-`; the one deliberately-destructive case (admin tenant delete) only ever targeted a tenant created by that same test case, gated by the product's own slug-confirmation dialog; a platform-branding color change and a tenant feature-flag toggle were both changed and explicitly verified reverted to their original values.

## Feature inventory (what's actually implemented)

Condensed from the full discovery pass (113 features across 7 areas). This is the "list every feature" ask — the detail behind each line (exact routes, API handlers, personas) is in the workflow transcript and available on request; this table is the readable summary.

| Area | Representative features |
|---|---|
| **Public site & auth** | Landing page, email/password sign-in & sign-up (email-verification-required), Google OAuth, forgot/reset password, magic-link auth (wired, no UI), invitation acceptance, public agent pages (`/{tenant}/{agent}`), agent short links, embeddable widget (page + JS snippet), password/invite-code access gates, QR codes, anonymous chat + history, legal pages, Meta data-deletion status page |
| **Agent creation & runtime** | Chat-driven agent creator wizard, "Improve with AI" instruction helper, Setup tab (name/instructions/greeting/mode/limits/quick-suggestions/memory), Info-Provider vs Info-Collector modes, response-limit enforcement (per-session + lifetime), quick-suggestion chips, anonymous-chat/access-gate toggle, Direct/RAG/Bash file retrieval strategies, `web_fetch`/`file_search`/sandboxed-`bash` tools, streaming chat runtime (OpenAI/Anthropic/Gemini/NVIDIA/OpenAI-compatible), agent-to-agent handoff, secret-authenticated inbound Hooks (sync/async/stream), version history & forward-only restore |
| **Knowledge / RAG / memory** | Knowledge tab (tools + files + source URLs), signed-URL direct-to-storage upload, extract→chunk→embed→index pipeline (PDF/DOCX/XLSX/images-via-OCR/etc.), re-embed on provider migration, file list/delete/download, pgvector retrieval (4 embedding-dimension tables + full-text fallback), long-term memory (recall/ingest, pending-mutation approval, observe/reconcile cron) |
| **Channels & integrations** | Embed widget, WhatsApp & Instagram inbox connection (3 methods each) + 24h-window tracking + human-takeover pause, Chatwoot sync, API Hooks, Calendar availability/scheduling/booking, Data Sync (Sheets/Airtable/webhook) — plus one copy nit still on `dev`: **"unified inbox"** is marketing language for two separate WhatsApp/Instagram UIs, not an actual merged view (an MCP-server-support claim was also found in the branch this audit started from, but is already absent from `origin/dev` — see *Executive summary*) |
| **Multi-tenancy, admin, billing** | Personal-workspace auto-creation, team workspace creation/switching, invites (create/list/cancel/accept), member role change/removal, tenant branding/feature-flags/Google-Review config, usage metering, plans, and the full Super Admin surface: platform branding, tenant list/create/edit/**delete** (slug-confirmed), any-tenant usage view, file-processing observability, any-agent detail view |
| **Agent dashboard (rest)** | Notifications (event triggers × in-app/email/webhook channels), Reviews (Google Review prompt) + visitor thumbs-up/down feedback, Share (link/QR), History (versions/restore), Ask AI (owner console over visitor conversations via RAG), Visitor/My Chat History panels, per-agent LLM override, workspace-level BYO-LLM provider settings |
| **Cross-cutting** | Postgres RLS-backed tenant isolation, encrypted per-workspace provider credentials, dark mode, responsive layout |

## Test results

| # | Use case | Priority | Status | Severity |
|---|---|---|---|---|
| 1 | Sign in — golden path | P0 | ✅ Pass | — |
| 2 | Sign in — wrong password rejected, no session | P0 | ✅ Pass | — |
| 3 | Sign up — email-verification boundary | P1 | ✅ Pass | — |
| 4 | Forgot password — no user enumeration | P1 | ✅ Pass | — |
| 5 | Google OAuth — redirect boundary | P0 | ✅ Pass | — |
| 6 | Landing page vs root — session-aware redirect, logout/login | P0 | ✅ Pass | — |
| 7 | Agent Creator Chat Wizard — create agent end-to-end | P0 | ✅ Pass | — |
| 8 | Setup tab — edit, save, persist across reload | P0 | ✅ Pass | — |
| 9 | **Knowledge tab — upload a file** | P1 | ❌ **Fail** | **Critical** |
| 10 | Anonymous public chat + Visitor Chat History | P0 | ✅ Pass | — |
| 11 | Access gate — password + invite code | P1 | ✅ Pass | — |
| 12 | Share tab — URL, QR, copy, open-in-new-tab | P1 | ⚠️ Partial | Low (investigated, cleared) |
| 13 | **History tab — version restore** | P1 | ❌ **Fail** | **Medium** |
| 14 | Multi-tenant workspace switching + isolation | P0 | ✅ Pass | — |
| 15 | Super Admin — tenant detail (read-only) | P0 | ✅ Pass | Low (cosmetic notes) |
| 16 | Super Admin — create/delete tenant lifecycle | P1 | ✅ Pass | — |
| 17 | Super Admin — platform branding read/write/revert | P1 | ✅ Pass | — |
| 18 | Tenant Settings — feature-flag toggle/revert | P1 | ✅ Pass | Low (unverified UX bug found) |
| 19 | BYO-LLM — provider CRUD | P1 | ✅ Pass | — |
| 20 | Team invite — create + cancel | P1 | ✅ Pass | — |
| 21 | Integrations — embed snippet + API Hooks lifecycle | P1 | ✅ Pass | — |
| 22 | WhatsApp OAuth connect boundary | P2 | 🚧 Blocked | Low (investigated, cleared — flag off) |
| 23 | Responsive / mobile viewport | P2 | ✅ Pass | — |
| 24 | Dark mode — apply/persist/revert | P2 | ✅ Pass | Low (unverified UX bug found) |
| 25 | Error handling — bad IDs, invalid Setup input | P2 | ⚠️ Partial | Low (investigated, cleared) |

**24/25 pass or effectively-pass; 1 confirmed critical failure; 1 confirmed medium failure buried inside an otherwise-passing area.**

## Confirmed defects

### 🔴 CRITICAL — Knowledge Base file upload is completely broken (staging **and production**)

> **RESOLVED 2026-08-14.** Both bucket policies have been applied and verified; production was confirmed affected by the identical defect. See [Update 2026-08-14](#update-2026-08-14--critical-file-upload-bug-resolved). The finding below is preserved as originally recorded.

**What happens:** Uploading any file on an agent's Knowledge tab fails 100% of the time with "Failed to fetch" / "1 file failed to upload." Reproduced deterministically with two different files.

**Root cause (confirmed by reading source):** File upload is direct-to-storage from the browser via a presigned URL (`apps/web/app/api/agents/[id]/files/upload-url/route.ts` → `getSignedUploadUrl()`). The browser's `PUT` goes straight to `https://vibesboard-staging-files.storage.googleapis.com/...`, a cross-origin request that requires the **bucket itself** to serve CORS headers on the preflight — this can't be fixed from the app's own response headers. `docs/deployment.md` documents this exact requirement (`gcloud storage buckets update --cors-file=cors.json`), but there's no CI/deploy automation that applies it, and no `cors.json` in the repo. Git history pins the trigger: commit `9c2ba1b`/`25dfc8a` ("point staging file storage at vibesboard-staging-files") migrated the staging bucket to a newly-provisioned one, and the CORS policy was never (re)applied to the new bucket.

**Impact:** RAG/knowledge-base upload — a headline capability on the landing page — is fully non-functional on staging as tested. **This should be checked against production immediately**, since the same "provision bucket → forget CORS" gap could easily exist there too if the step is manual and undocumented in the deploy pipeline.

**Suggested fix:** apply the bucket CORS policy from `docs/deployment.md` to the actual staging (and verify prod) bucket, and consider adding it to the deploy scripts so a future bucket rename/migration can't silently break this again. Secondary UX gap noted along the way: a failed upload leaves no lasting "failed" indicator in the file list (only a transient toast) — a user who dismisses the toast has no evidence anything went wrong.

### 🟡 MEDIUM — Agent History tab shows a stale "Current" badge after Save or Restore

> **RESOLVED 2026-08-14.** See [Update 2026-08-14 (2)](#update-2026-08-14-2--medium-bug-and-every-minor-finding-resolved). The finding below is preserved as originally recorded.

**What happens:** Right after saving Setup changes or restoring an old version, the History tab briefly (until a full page reload) marks the *wrong* version row as "Current" and shows a spurious Restore button on the actually-current row. Reproduced twice, deterministically (once after a Setup save, once after a Restore).

**Root cause (confirmed by reading source):** `AgentVersionHistoryTab` gets its "current version" from a prop threaded down from the page's React Server Component tree, which only updates on a full `router.refresh()`. The tab *also* fetches its own fresh version list via `GET /api/agents/{id}/versions` — which already computes the correct current version server-side — but the client component's type/interface doesn't even include that field, and silently discards it. Because the tab's own lightweight fetch resolves faster than the page-wide RSC refresh, the versions list updates before the "current" indicator does, so they briefly disagree. Underlying data integrity is unaffected (all versions are correctly stored, restore always targets the right version) — this is a display/UX bug, not a data bug.

**Suggested fix:** have the History tab use the `currentVersion`/`isCurrent` field its own `/versions` fetch already returns, instead of the stale RSC-sourced prop.

## Investigated and cleared (not real bugs)

Reported so nothing is silently dropped, but code-level verification found these are **not** application defects:

- **MCP server support marketed but unimplemented.** Feature discovery flagged this as a live issue while reading the branch this audit started from (`chore/pre-flip-fixes`) — `CLAUDE.md`/`AGENTS.md` and the public landing page both claimed it, but a repo-wide grep found zero implementation anywhere. Cross-checked directly against `git show origin/dev:...` for both files before finalizing this report: **`origin/dev` — the actual target of this PR and what will actually ship — already has the claim removed from both the landing page copy and the internal docs.** No action needed; this is included only so the gap between the checked-out branch and `dev` doesn't look like an unexplained discrepancy. `SECURITY.md` still lists MCP servers as one class of tool-integration attack surface to design against generically — that's forward-looking threat-model language, not a feature claim, so it's fine as-is. The related **"unified inbox" wording is still present on `dev`** (`README.md`, `packages/policy/src/feature-flags.ts`'s `INBOX` flag description) and is a much smaller, optional copy nit: WhatsApp and Instagram are two separate sidebar sections/route trees today, not a literal merged inbox view.
- **UC12 — missing "Copied" confirmation on the Share tab's Copy button.** Source (`agent-share-tab.tsx`) correctly implements a 1200ms "Copied" state change. The clipboard copy itself worked in testing. Most likely explanation: the testing agent's own verification sequence (two clicks, then an external `pbpaste` process round-trip, then a DOM re-inspection) plausibly took longer than the 1200ms window before checking. Minor genuine nit even so: **1200ms is a short window** for a real user who glances away — worth considering a slightly longer duration, but not a defect.
- **UC22 — WhatsApp "Connect" button never reachable.** Confirmed via the tenant's own Features admin tab: `WHATSAPP_INBOX` (and its parent `INBOX` flag) are simply turned **off** for the `Acme Staging Team` test tenant — correct, intentional gating, not a bug. Either enable the flag on a designated staging tenant if this flow needs regular exercise, or treat as out of scope until Inbox is GA.
- **UC25 — identical 404 for a malformed vs. a syntactically-valid-but-nonexistent agent ID.** `getAgentById` intentionally returns "not found" for both cases (source comment confirms this is deliberate, to avoid leaking whether a caller's ID even has the right shape across a public/shared entry point). The use case's own expectation of "distinct" error text didn't match the app's actual, reasonable design. Setup-tab Name validation (the rest of this use case) passed cleanly — the Save button is disabled client-side for empty/>120-char names, which is a *more* robust guard than a post-submit error.

## Other findings worth a ticket (observed with strong repro detail, not run through the adversarial code-verification pass because their host use case technically "passed")

> **All four items below are RESOLVED 2026-08-14** — see [Update 2026-08-14 (2)](#update-2026-08-14-2--medium-bug-and-every-minor-finding-resolved), which also corrects two of them (the branding-preview mechanism, and the true scope of the "Pending" status bug) against what code-level investigation actually found. Findings below are preserved as originally recorded.

- **Two different, disagreeing access-check implementations on `/settings/tenant`** (found while testing UC18): the page shows a "you do not have admin access" banner and hides the tenant from the workspace switcher for `staging-e2e@example.com` on `Invited Staging Org` — but the account demonstrably *does* have full access (every read/write on that page succeeded, and the page's own RSC payload computes `canManageTenant:true`). Not a security hole (the stricter check only produces a false negative, backend still correctly permits what it should), but a real admin seeing this banner would reasonably conclude they're locked out and give up.
- **Dark-mode toggle mislabeled for first-time OS-dark visitors** (found while testing UC24): a visitor whose OS is already in dark mode, who has never touched the in-app toggle, sees a button labeled "Switch to dark mode" — but the app is already rendering dark (via `prefers-color-scheme`). Clicking it flips them to **light**, the opposite of what the label promised. Once one explicit choice is made, subsequent toggles are fully correct. First-impression-only edge case.
- **Admin → Tenant → Branding "Live Preview" shows hardcoded placeholder colors** (`#aabbcc`/`#ddeeff`) that don't reflect the tenant's real (inherited) values shown just above it — cosmetic/confusing, not a functional bug.
- **"Acme Staging Team" tenant shows status "Pending"** in the admin tenant list/detail despite being a long-lived, actively-used reference tenant — may be intentional (e.g. a billing/plan state distinct from tenant health), but surprising enough to warrant a quick sanity check.
- **Agent-creation wizard's form fields don't always react to programmatic value-setting** without a real keystroke event (seen twice, on two different automation attempts) — very likely a browser-automation-tooling quirk rather than something a typing user hits, but worth a glance since some legitimate flows (password managers, browser autofill) also bypass normal keydown events.

## Coverage — what this pass did *not* test

Named explicitly rather than silently implied as covered, per the discovery+design phase's own gap list:

Magic-link sign-in (no UI entry point); real email-verification/password-reset link completion (no inbox access); the agent short-link route's distinct lockout behavior; the embeddable widget's actual runtime behavior on a real third-party host page; the Meta data-deletion status page and static legal pages; Info-Collector mode in depth (Collection Fields, completion marker); response-limit banners in live chat; quick-suggestion chip click behavior; agent-to-agent handoff UI; Hooks' actual invocation (only CRUD was tested, not calling the endpoint with the secret); the Memory tab and its approve/reject flow; Notifications tab delivery; Reviews tab; visitor thumbs-up/down; the Ask AI console; Bash retrieval strategy; re-embed-on-provider-change; Chatwoot; Instagram OAuth boundary; the Actions tab (Calendar/Sheets/Airtable/webhook booking flows, gated behind a feature flag); the tenant Usage page; the admin File Processing monitor and cross-tenant agent viewer; true cross-tenant 403s from a second, independent low-privilege account (only one super-admin account was available); member role-change/removal; rate-limit (429) behavior under brute force; and the `.doc`/`.ppt` legacy-file-upload edge case (accepted by the MIME allow-list but has no text extractor implemented).

## Appendix — evidence

Screenshots for every failing/partial/blocked/notable case were captured during testing and are available on request (not included in this PR to keep it reviewable): `qa-uc-{9,12,13,15,18,22,24,25}*.png`.
