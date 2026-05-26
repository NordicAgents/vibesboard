# Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax. **This is an OPS/release plan, not a code-with-tests plan** — most steps are exact gcloud/git commands with expected output. Steps are tagged **[ASSISTANT]** (I run it) or **[USER]** (you run it — secret values, DNS, OAuth, and the go/no-go gates).

**Goal:** Release the migrated stack (`dev`, 88 commits ahead) to production: stand up a prod Postgres data-plane mirroring staging, wire prod env/secrets, serve prod at https://vibesboard.com on the existing `vibeagent` Cloud Run service, then tear down the old Firebase/Firestore/Stripe resources.

**Architecture:** Fresh start (empty prod Postgres, no data/auth migration). Mirror the proven staging setup: e2-micro Postgres VM (pgvector + RLS roles, private IP), Direct VPC egress at runtime + IAP tunnel for CD migrations, GCS files via S3 API. The shared `deploy-cloudrun.yml` already branches PROD vs STAGING on `github.ref_name`; we extend its `main` path to mount the prod data-plane.

**Tech Stack:** GCP (Compute Engine, Cloud Run, Secret Manager, Cloud Storage, Cloud Functions, Firestore), GitHub Actions CD, Drizzle migrations, gcloud + gh CLIs. Reference: `docs/superpowers/plans/2026-05-23-staging-postgres-infra.md` (the staging VM/pgvector/role commands to mirror).

**Known facts:** prod service = `vibeagent` (europe-north1, image `app:11dd7d8…`). Staging VM = `vibesboard-staging-pg` (e2-micro, us-central1-a, default network, IP 10.128.0.2). Migrations 0000–0010. CD migrate job is currently `if: github.ref_name == 'dev'` only and reads `secrets.STAGING_DATABASE_MIGRATE_URL`; dev-gated runtime lines mount `*-staging` GCP secrets + VPC flags.

**⚠️ Cost note:** GCP's always-free tier covers ONE e2-micro/month (used by staging). A second e2-micro for prod is billable (~$6–7/mo). Acceptable per the design; flagging so it's not a surprise.

---

## Task 1: Provision the prod Postgres VM [ASSISTANT]

**Mirror `vibesboard-staging-pg`.** Follow `docs/superpowers/plans/2026-05-23-staging-postgres-infra.md` exactly, substituting the prod names below. That plan has the full startup-script (Postgres 16 + pgvector install), role creation, and pg_hba/listen config — reuse it verbatim with these substitutions.

| Staging | Prod |
|---|---|
| instance `vibesboard-staging-pg` | `vibesboard-prod-pg` |
| zone `us-central1-a` | `us-central1-a` |
| db `vibesboard` | `vibesboard` |
| roles `vibesboard_migrate` / `vibesboard_app` | same names |

- [ ] **Step 1: Create the VM** (e2-micro, default network, no external IP)

```bash
gcloud compute instances create vibesboard-prod-pg \
  --project vibesboard --zone us-central1-a --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud \
  --network default --subnet default --no-address \
  --metadata-from-file startup-script=<(echo "REUSE the staging startup-script from 2026-05-23-staging-postgres-infra.md verbatim")
```
Expected: instance created, `STATUS: RUNNING`, an internal IP (e.g. `10.128.0.x`). Record the IP.

- [ ] **Step 2: Wait for the startup script, then verify Postgres + pgvector + roles** via an IAP tunnel + psql exactly as the staging plan's verification step does (the staging plan shows the `gcloud compute start-iap-tunnel vibesboard-prod-pg 5432` + `psql` checks: `CREATE EXTENSION vector` present, `vibesboard_migrate` has BYPASSRLS, `GRANT CREATE ON DATABASE vibesboard TO vibesboard_migrate`). Expected: `vector` in `\dx`, both roles exist.

- [ ] **Step 3: Record both connection-string forms** (do NOT commit these; they feed Task 3/4):
  - Runtime (private IP, app role): `postgresql://vibesboard_app:<APP_PW>@<PRIVATE_IP>:5432/vibesboard`
  - Migrate runtime (private IP, migrate role): `postgresql://vibesboard_migrate:<MIGRATE_PW>@<PRIVATE_IP>:5432/vibesboard`
  - Migrate CI/IAP form (localhost via tunnel): `postgresql://vibesboard_migrate:<MIGRATE_PW>@localhost:5432/vibesboard`

No commit (infra only).

---

## Task 2: Prod GCS files bucket (CORS + IAM + HMAC) [ASSISTANT, with USER for the secret value]

The prod bucket `vibeagent-files` already exists. Mirror the staging bucket wiring.

- [ ] **Step 1: Apply CORS for vibesboard.com**

```bash
cat > /tmp/prod-cors.json <<'JSON'
[{"origin":["https://vibesboard.com"],"method":["GET","PUT","HEAD"],"responseHeader":["Content-Type"],"maxAgeSeconds":3600}]
JSON
gcloud storage buckets update gs://vibeagent-files --cors-file=/tmp/prod-cors.json --project vibesboard
```
Verify: `gcloud storage buckets describe gs://vibeagent-files --format="json(cors_config)"` shows the policy.

- [ ] **Step 2: Grant the prod Cloud Run service account objectAdmin** on the bucket (find the prod SA: `gcloud run services describe vibeagent --region europe-north1 --format="value(spec.template.spec.serviceAccountName)"`; default is the compute SA `319148717246-compute@developer.gserviceaccount.com`):

```bash
gcloud storage buckets add-iam-policy-binding gs://vibeagent-files \
  --member=serviceAccount:319148717246-compute@developer.gserviceaccount.com \
  --role=roles/storage.objectAdmin --project vibesboard
```

- [ ] **Step 3: Create prod GCS HMAC keys** (the S3-API creds). HMAC keys belong to a service account:

```bash
gcloud storage hmac keys create 319148717246-compute@developer.gserviceaccount.com --project vibesboard
```
Output prints `accessId` (the access key id) and `secret` ONCE. **[USER]** capture both — they feed Task 3 (S3 secrets). Do not let the secret print into shared logs.

---

## Task 3: Create prod GCP Secret Manager secrets [USER provides values via `!` commands]

Each value is created so it never passes through the assistant — run these yourself (the `!` prefix runs them in this session). Mirror the staging secret set.

- [ ] **Step 1: better-auth secret**
```
! openssl rand -hex 32 | gcloud secrets create better-auth-secret-prod --project vibesboard --replication-policy=automatic --data-file=-
```
- [ ] **Step 2: database-url-prod** (runtime, app role, private IP from Task 1)
```
! printf '%s' 'postgresql://vibesboard_app:APP_PW@PRIVATE_IP:5432/vibesboard' | gcloud secrets create database-url-prod --project vibesboard --replication-policy=automatic --data-file=-
```
- [ ] **Step 3: database-migrate-url-prod** (runtime, migrate role, private IP — used by getMigrateDb at runtime)
```
! printf '%s' 'postgresql://vibesboard_migrate:MIGRATE_PW@PRIVATE_IP:5432/vibesboard' | gcloud secrets create database-migrate-url-prod --project vibesboard --replication-policy=automatic --data-file=-
```
- [ ] **Step 4: s3 creds** (accessId / secret from Task 2 Step 3)
```
! printf '%s' 'HMAC_ACCESS_ID' | gcloud secrets create s3-access-key-id-prod --project vibesboard --replication-policy=automatic --data-file=-
! printf '%s' 'HMAC_SECRET' | gcloud secrets create s3-secret-access-key-prod --project vibesboard --replication-policy=automatic --data-file=-
```
- [ ] **Step 5: verify** `gcloud secrets list --project vibesboard | grep -E "prod"` shows all 5 (`better-auth-secret-prod`, `database-url-prod`, `database-migrate-url-prod`, `s3-access-key-id-prod`, `s3-secret-access-key-prod`).

---

## Task 4: Create the GitHub Actions repo secrets [USER provides DB-URL value; ASSISTANT can set the non-secret ones]

The CD reads several `secrets.PROD_*` GitHub Actions secrets. Set them with `gh secret set`.

- [ ] **Step 1 [ASSISTANT]: non-sensitive PROD_* repo secrets**
```bash
printf '%s' 'vibeagent' | gh secret set PROD_CLOUD_RUN_SERVICE
printf '%s' 'https://vibesboard.com' | gh secret set PROD_NEXT_PUBLIC_APP_URL
printf '%s' 'vibeagent-files' | gh secret set PROD_GCS_BUCKET_NAME
```
- [ ] **Step 2 [USER]: the migrate-URL CI form** (localhost/IAP form from Task 1 Step 3 — has the DB password, so you set it):
```
! printf '%s' 'postgresql://vibesboard_migrate:MIGRATE_PW@localhost:5432/vibesboard' | gh secret set PROD_DATABASE_MIGRATE_URL
```
- [ ] **Step 3 [USER]: the NEXT_PUBLIC build-arg secrets** the workflow references on `main` (copy the staging values if the same client/app, else the prod values): `PROD_NEXT_PUBLIC_AUTH_GOOGLE`, `PROD_NEXT_PUBLIC_META_APP_ID`, `PROD_NEXT_PUBLIC_FB_LOGIN_CONFIG_ID`. e.g. `! printf '%s' 'true' | gh secret set PROD_NEXT_PUBLIC_AUTH_GOOGLE`.
- [ ] **Step 4: verify** `gh secret list | grep PROD_` shows all of the above.

---

## Task 5: Extend the CD workflow's prod (`main`) path [ASSISTANT — code change]

**File:** Modify `.github/workflows/deploy-cloudrun.yml`.

- [ ] **Step 1: Generalize the `migrate` job to run on `main` too** (currently `if: github.ref_name == 'dev'`, hard-coded staging VM + secret). Make the branch-conditional pick the VM + migrate-URL:

Change line 28 `if: github.ref_name == 'dev'` → `if: github.ref_name == 'dev' || github.ref_name == 'main'`.

Change the IAP tunnel target (line ~48) and the `DATABASE_MIGRATE_URL` env (line ~54):
```yaml
          gcloud compute start-iap-tunnel ${{ github.ref_name == 'main' && 'vibesboard-prod-pg' || 'vibesboard-staging-pg' }} 5432 \
        ...
          DATABASE_MIGRATE_URL: ${{ github.ref_name == 'main' && secrets.PROD_DATABASE_MIGRATE_URL || secrets.STAGING_DATABASE_MIGRATE_URL }}
```
(The prod VM is also in `us-central1-a` like staging, so the tunnel's zone flag is unchanged. Confirm the migrate job's `--zone` matches; both `us-central1-a`.)

- [ ] **Step 2: Make the dev-gated runtime lines prod-aware.** Replace each `${{ github.ref_name == 'dev' && 'X=…staging…' || '' }}` so `main` gets the prod value. Concretely:

`flags:` (line ~115):
```yaml
          flags: ${{ (github.ref_name == 'dev' || github.ref_name == 'main') && '--network=default --subnet=default --vpc-egress=private-ranges-only' || '' }}
```
`env_vars:` S3 block (lines ~121-125) — S3_ENDPOINT/REGION/FORCE_PATH_STYLE are identical for both; S3_BUCKET differs; BETTER_AUTH_URL uses the per-env public URL:
```yaml
            ${{ (github.ref_name == 'dev' || github.ref_name == 'main') && 'S3_ENDPOINT=https://storage.googleapis.com' || '' }}
            ${{ (github.ref_name == 'dev' || github.ref_name == 'main') && 'S3_REGION=us-east-1' || '' }}
            S3_BUCKET=${{ github.ref_name == 'main' && 'vibeagent-files' || (github.ref_name == 'dev' && 'vibeagent-files-staging') || '' }}
            ${{ (github.ref_name == 'dev' || github.ref_name == 'main') && 'S3_FORCE_PATH_STYLE=false' || '' }}
            ${{ github.ref_name == 'main' && format('BETTER_AUTH_URL={0}', secrets.PROD_NEXT_PUBLIC_APP_URL) || (github.ref_name == 'dev' && format('BETTER_AUTH_URL={0}', secrets.STAGING_NEXT_PUBLIC_APP_URL)) || '' }}
```
`secrets:` block (lines ~142-146):
```yaml
            DATABASE_URL=${{ github.ref_name == 'main' && 'database-url-prod:latest' || (github.ref_name == 'dev' && 'database-url-staging:latest') || '' }}
            DATABASE_MIGRATE_URL=${{ github.ref_name == 'main' && 'database-migrate-url-prod:latest' || (github.ref_name == 'dev' && 'database-migrate-url-staging:latest') || '' }}
            BETTER_AUTH_SECRET=${{ github.ref_name == 'main' && 'better-auth-secret-prod:latest' || (github.ref_name == 'dev' && 'better-auth-secret-staging:latest') || '' }}
            S3_ACCESS_KEY_ID=${{ github.ref_name == 'main' && 's3-access-key-id-prod:latest' || (github.ref_name == 'dev' && 's3-access-key-id-staging:latest') || '' }}
            S3_SECRET_ACCESS_KEY=${{ github.ref_name == 'main' && 's3-secret-access-key-prod:latest' || (github.ref_name == 'dev' && 's3-secret-access-key-staging:latest') || '' }}
```
(`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` at lines 139-140 are unconditional `:latest` — they already apply to prod; the prod OAuth redirect URI is added in Task 6. `NEXT_PUBLIC_APP_URL` line 119 already uses the `main ? PROD : STAGING` pattern → resolves to vibesboard.com on main.)

- [ ] **Step 3: Validate the YAML** locally: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-cloudrun.yml')); print('valid')"` → `valid`. (GitHub Actions expressions inside strings are fine for the YAML parser.)

- [ ] **Step 4: Commit on a branch + PR + merge to `dev` first** (so the change is on dev before the dev→main merge carries it to prod):
```bash
git add .github/workflows/deploy-cloudrun.yml
git commit -m "ci(deploy): wire prod (main) data-plane env/secrets + migrate job"
```
PR → CI green → merge to `dev`. **Verify the dev/staging deploy still works after this edit** (the dev path must be unchanged in behavior) — watch the triggered staging deploy go green and `dev.vibesboard.com` still serves.

---

## Task 6: Domain mapping + OAuth redirect [USER actions + one ASSISTANT command]

- [ ] **Step 1 [ASSISTANT]: map vibesboard.com → vibeagent**
```bash
gcloud beta run domain-mappings create --service vibeagent --domain vibesboard.com --region europe-north1 --project vibesboard
```
(Requires the `beta` component; if it prompts to install, that's fine. Outputs the DNS records to add.)
- [ ] **Step 2 [USER]: add the DNS records** Cloud Run returned, at your domain registrar for `vibesboard.com` (apex A/AAAA or the provided CNAME). Wait for the managed cert to provision (`gcloud beta run domain-mappings describe --domain vibesboard.com --region europe-north1` → `CertificateProvisioned` / Ready).
- [ ] **Step 3 [USER]: add the prod OAuth redirect URI** `https://vibesboard.com/api/auth/callback/google` to the existing Google OAuth client (the one whose id/secret are in `google-oauth-client-id`/`google-oauth-client-secret`). Keep the existing dev.vibesboard.com URI too.
- [ ] **Fallback:** if DNS/cert isn't ready by Task 7, temporarily set `PROD_NEXT_PUBLIC_APP_URL` to the `vibeagent-…run.app` URL + add that run.app `/api/auth/callback/google` redirect, cut over, then switch to vibesboard.com after DNS resolves (a one-line secret change + redeploy).

---

## Task 7: Release — merge dev → main [ASSISTANT, gated on Tasks 1–6 done]

Per CLAUDE.md: **real merge commit, NOT squash/rebase.**

- [ ] **Step 1: Open the dev→main PR**
```bash
gh pr create --base main --head dev --title "release: Firestore→Postgres migration + Firebase removal to production" --body "Cuts production over to the migrated Postgres/Better-Auth stack. Prod data-plane (vibesboard-prod-pg, secrets, CD wiring) provisioned per the cutover plan. Fresh start (empty prod DB)."
```
- [ ] **Step 2: Merge with a MERGE COMMIT** (GitHub UI "Create a merge commit", or):
```bash
gh pr merge <PR#> --merge   # --merge = merge commit, NOT --squash
```
- [ ] **Step 3: Watch prod CD** (`gh run list --branch main --workflow deploy-cloudrun.yml`): the `migrate` job tunnels to `vibesboard-prod-pg` and applies 0000–0010 to the empty prod DB; `deploy` ships to `vibeagent`. Both must be `success`. Confirm the migrate log shows migrations applied (not "0 applied").
- [ ] **Step 4: Back-merge main → dev** to align tips (per CLAUDE.md):
```bash
git checkout dev && git pull && git merge origin/main --no-ff -m "chore: sync main into dev after release" && git push origin dev
```

---

## Task 8: Verify prod [ASSISTANT + USER for Google login]

- [ ] **Step 1:** `curl -s -o /dev/null -w "%{http_code}" https://vibesboard.com/api/agents` (or run.app fallback) → 200 (or 401/redirect if unauth — NOT 500). App boots on Postgres.
- [ ] **Step 2 [USER + ASSISTANT via Chrome]:** on https://vibesboard.com — sign up with email (verify email flow) AND Google login (uses the prod redirect URI); create a workspace + agent; upload a file → ask a file-only question → RAG answers; send a chat → reload → history persists.
- [ ] **Step 3:** confirm no Firestore/firebase in the running prod image — `gcloud run services describe vibeagent --region europe-north1 --format="yaml(spec.template.spec.containers[0].env)"` shows `DATABASE_URL`/`BETTER_AUTH_SECRET`/`S3_*` mounted and the image is the new SHA (not `11dd7d8`).
- [ ] **GATE:** Task 9 (teardown) only proceeds if Step 1–3 all pass. **[USER] explicit go-ahead required.**

---

## Task 9: Teardown old cloud resources [ASSISTANT — IRREVERSIBLE, gated on Task 8 + USER go-ahead]

Do NOT run any of these until Task 8 passes and the user explicitly confirms.

- [ ] **Step 1 (optional safety backup) [USER decision]:** export Firestore before deletion:
```bash
gcloud firestore export gs://vibeagent-files/firestore-backup-$(date +%Y%m%d) --project vibesboard
gcloud firestore export gs://vibeagent-files-staging/firestore-backup-$(date +%Y%m%d) --project vibesboard-staging
```
- [ ] **Step 2: delete the old Cloud Functions**
```bash
for fn in onFileCreated onMessageStatusUpdate processWhatsAppQueue onUserCreated; do gcloud functions delete "$fn" --region europe-north1 --project vibesboard --gen2 --quiet; done
```
(If a function is gen1 or in another region, adjust `--gen2`/`--region` from `gcloud functions list`.)
- [ ] **Step 3: delete the Firestore databases** (irreversible)
```bash
gcloud firestore databases delete --database='(default)' --project vibesboard --quiet
gcloud firestore databases delete --database='(default)' --project vibesboard-staging --quiet
```
- [ ] **Step 4: delete dead secrets**
```bash
for s in firebase-service-account-key firebase-service-account-key-staging stripe-secret-key stripe-webhook-secret stripe-price-pro-base stripe-price-pro-overage stripe-price-team-base stripe-price-team-overage; do gcloud secrets delete "$s" --project vibesboard --quiet; done
```
- [ ] **Step 5: delete orphaned gcf-* source/upload buckets** (only the `gcf-*` ones; NOT `vibeagent-files*` or `run-sources-*`):
```bash
for b in gcf-sources-319148717246-us-central1 gcf-v2-sources-319148717246-europe-north1 gcf-v2-sources-319148717246-us-central1 gcf-v2-uploads-319148717246.europe-north1.cloudfunctions.appspot.com gcf-v2-uploads-319148717246.us-central1.cloudfunctions.appspot.com; do gcloud storage rm -r "gs://$b" --project vibesboard; done
```
- [ ] **Step 6: verify** `gcloud functions list`, `gcloud firestore databases list`, `gcloud secrets list | grep -E "firebase|stripe"` → empty. Prod still healthy (re-run Task 8 Step 1).

---

## Self-Review

- **Spec coverage:** Phase 1→Task 1; Phase 2→Tasks 2–5; Phase 3→Task 6; Phase 4→Task 7; Phase 5→Task 8; Phase 6→Task 9. ✓ Stripe removal = consequence of the merge (Task 7), confirmed pre-launch. ✓ Rollback = old `vibeagent` image untouched until Task 9 (noted in spec). ✓ run.app fallback → Task 6 Fallback. ✓
- **Placeholder scan:** Task 1 references the staging plan's startup-script rather than inlining it — that's a deliberate DRY pointer to an existing exact artifact, not a placeholder; the substitution table makes it concrete. All other steps have exact commands.
- **Consistency:** secret names (`*-prod`), VM name (`vibesboard-prod-pg`), bucket (`vibeagent-files`), service (`vibeagent`), URL (`https://vibesboard.com`) are consistent across Tasks 1–9 and match the workflow edits in Task 5.
- **Ordering/gates:** Tasks 1–6 are prep (no prod impact); Task 7 is the cutover; Task 9 is irreversible + double-gated (verify + user go-ahead). The Task 5 workflow edit lands on `dev` first so the dev→main merge carries it.
