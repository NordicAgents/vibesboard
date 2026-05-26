# Production Cutover — Design

**Date:** 2026-05-25
**Status:** Approved (brainstorming)
**Context:** The Firestore→Postgres migration + Better Auth + Firebase removal (PRs #170–195) is complete and verified on **staging** (`vibesboard-staging` service, `dev` branch, `dev.vibesboard.com`). Production has NOT been cut over: `main` is 88 commits behind `dev`; the prod `vibeagent` Cloud Run service runs image `app:11dd7d8…` (2026-04-26, pre-migration) = the old Firestore + Firebase Auth + Stripe stack.

## Goal

Release the migrated stack to production: stand up a prod Postgres data-plane mirroring staging, wire prod env/secrets, serve prod at **https://vibesboard.com**, release `dev → main`, verify, then tear down the now-unused Firebase/Firestore/Stripe cloud resources.

## Key decisions (from brainstorming)

1. **Fresh start — no data migration.** Prod is pre-launch with negligible data. We do NOT migrate Firestore data to Postgres and do NOT migrate Firebase-Auth users to Better Auth. Prod Postgres starts empty; users re-register. (This removes the two largest, riskiest workstreams.)
2. **Prod Postgres = a new always-free e2-micro VM**, dedicated to prod, isolated from the staging VM, mirroring the proven `vibesboard-staging-pg` setup (pgvector + RLS roles + private IP + Direct VPC egress at runtime + IAP tunnel for CD migrations).
3. **Prod URL = https://vibesboard.com** (apex domain; staging stays `dev.vibesboard.com`). Mapped to the existing `vibeagent` Cloud Run service. **Fallback:** if DNS/domain-mapping isn't ready on cutover day, go live on the existing `vibeagent-…run.app` URL first and map vibesboard.com immediately after (a low-risk follow-up; only `NEXT_PUBLIC_APP_URL`/`BETTER_AUTH_URL` + the OAuth redirect differ).
4. **Stripe is removed by the cutover** (the migrated code has no Stripe — stripped in #168). Acceptable: prod is pre-launch with no live billing.

## Architecture / Phases

### Phase 1 — Prod data-plane infra (no prod impact)
- New e2-micro VM `vibesboard-prod-pg` (same zone family as staging, private IP only), PostgreSQL 16 + pgvector, mirroring `vibesboard-staging-pg`:
  - `migrate` role (BYPASSRLS) + app role (RLS-enforced), `GRANT CREATE ON DATABASE` to migrate role.
  - Reached at runtime via Direct VPC egress; CD migrations via IAP tunnel (`gcloud compute start-iap-tunnel vibesboard-prod-pg 5432`).
- Prod GCS files bucket: `vibeagent-files` already exists — add a CORS policy for `https://vibesboard.com` (GET/PUT/HEAD), mirroring the staging bucket; grant the prod Cloud Run service account `roles/storage.objectAdmin` on it (as done for staging).
- Generate prod S3 (GCS HMAC) credentials for `vibeagent-files`.

### Phase 2 — Prod secrets + CD wiring (no prod impact until merge)
- Create prod GCP secrets: `database-url-prod`, `database-migrate-url-prod` (private-IP runtime form + localhost/IAP form for CD, mirroring the two staging variants), `better-auth-secret-prod` (`openssl rand -hex 32`), `s3-access-key-id-prod`, `s3-secret-access-key-prod`.
- Extend `.github/workflows/deploy-cloudrun.yml`'s **`main`** path to mount the same data-plane env/secrets the `dev` path already has (currently gated `github.ref_name == 'dev'` only): `DATABASE_URL`, `DATABASE_MIGRATE_URL`, `BETTER_AUTH_SECRET`, `S3_ENDPOINT`/`S3_REGION`/`S3_BUCKET=vibeagent-files`/`S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `BETTER_AUTH_URL`, and the Direct-VPC-egress `flags`. Use prod secret names on `main`, staging names on `dev` (via the existing `ref_name == 'main' ? PROD : STAGING` pattern). `NEXT_PUBLIC_APP_URL`/`BETTER_AUTH_URL` = `https://vibesboard.com`.
- Add the prod `migrate` job IAP tunnel target (`vibesboard-prod-pg`) under the `main` branch condition.

### Phase 3 — Domain + OAuth (user actions + one CLI step)
- Map `vibesboard.com` → `vibeagent` (Cloud Run domain mapping; I can run the mapping command). User adds the DNS records Cloud Run returns.
- User adds `https://vibesboard.com/api/auth/callback/google` as an authorized redirect URI on the existing Google OAuth client (reuse the same `google-oauth-client-id`/`google-oauth-client-secret`; one client can carry both staging + prod redirect URIs).

### Phase 4 — Release (the cutover moment)
- Per CLAUDE.md: merge `dev → main` with a **real merge commit** ("Create a merge commit" — NOT squash/rebase). Immediately back-merge `main → dev` (`git merge origin/main --no-ff`) to keep tips aligned.
- The push to `main` triggers prod CD: the `migrate` job applies all 10 migrations (0000–0010) to the empty prod DB; the `deploy` job ships the migrated image to `vibeagent`. Prod is now on Postgres/Better Auth, Firebase-free.

### Phase 5 — Verify
- Prod smoke on vibesboard.com (or the run.app fallback): sign up (email + Google login), create workspace + agent, upload a file → RAG chat answers from it, conversation persists, reload shows history. Confirm the running prod image has no `firebase-admin`/Firestore (the deployed `dev` code already passed this gate).

### Phase 6 — Teardown (irreversible — gated on Phase 5 passing)
Delete the now-unused cloud resources:
- Both Firestore `(default)` databases (`vibesboard`, `vibesboard-staging`) — optional Firestore export to GCS first as a cold backup.
- The 5 old Cloud Functions (`onFileCreated`×2, `onMessageStatusUpdate`, `processWhatsAppQueue`, `onUserCreated`) + their Cloud Run wrappers + `gcf-*` source/upload buckets + stale `gcf-artifacts` images.
- Secrets `firebase-service-account-key`, `firebase-service-account-key-staging`, `stripe-secret-key`, `stripe-webhook-secret`, `stripe-price-pro-base`, `stripe-price-pro-overage`, `stripe-price-team-base`, `stripe-price-team-overage`.

**Keep:** the staging + prod Postgres VMs, `vibeagent-files` + `vibeagent-files-staging` buckets, all `google-*`/`database-*`/`better-auth-*`/`s3-*`/`access-gate`/`encryption`/`cron`/`openai`/`resend`/`whatsapp-*`/`instagram-*`/`meta-app-secret` secrets, Better Auth, RISC.

## Risks & mitigations
- **Migrate job ordering gotcha (learned in #191):** any future migration's journal `when` must be strictly greater than the prior entry's, or `drizzle-kit migrate` silently skips it. On a fresh prod DB all 10 apply in order, so this is not a cutover risk — noted for future migrations.
- **Rollback:** the old stack (Firestore, functions, secrets, `vibeagent` old image) is untouched until Phase 6, so rollback = redeploy the prior `vibeagent` image (`app:11dd7d8…`) or revert the merge commit. Clean and fast until teardown.
- **DNS propagation / cert:** Cloud Run managed cert for vibesboard.com can take time; the run.app fallback (decision 3) avoids blocking the cutover on DNS.
- **OAuth redirect mismatch:** if the vibesboard.com redirect URI isn't added before Phase 4, Google login throws `redirect_uri_mismatch` — Phase 3 is a prerequisite for Phase 4 (or cut over on run.app first with its redirect already present).
- **Prod secret value handling:** prod DB password / HMAC / better-auth secret are created by the user (or via `!`-prefixed commands) so values never pass through the assistant, same as the staging Google secret.

## Non-goals
- Firestore→Postgres data migration; Firebase-Auth user migration (fresh start).
- Custom domain for staging (already dev.vibesboard.com).
- Managed Cloud SQL (deferred; e2-micro VM for now, upgrade when real traffic arrives).
- Re-introducing Stripe/billing.

## Success criteria
Prod (`vibeagent`) serves the migrated app at https://vibesboard.com on Postgres + Better Auth with zero Firebase data-plane dependency; sign-up/login/agent/RAG-chat verified; the old Firebase/Firestore/Stripe cloud resources are torn down; `main` and `dev` tips aligned.
