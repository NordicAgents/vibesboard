# Staging Postgres Infrastructure (Free e2-micro) — Implementation Plan

> **For agentic workers:** This is an infrastructure runbook. Steps are discrete `gcloud`/shell commands or YAML edits, each with a verification command (the infra analogue of a test). Execute top-to-bottom; do not parallelize (state is sequential). The provisioning tasks (1–6) are run by the operator with the local `gcloud` account (`midhunxavier1993@gmail.com`); Task 7 is a code change to the CD workflow; Task 8 deploys + verifies. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up a free, GCP-native, private Postgres (pgvector) for staging and wire Postgres + Better Auth + S3 into the Cloud Run CD pipeline, so the migrated app runs and is e2e-tested on real staging.

**Architecture:** Self-managed PostgreSQL 16 + pgvector on an Always-Free `e2-micro` VM (`us-central1`, private IP, no external IP). The Cloud Run staging service reaches it at runtime via **Direct VPC egress**; CD runs migrations from the GitHub runner over an **IAP TCP tunnel**. Object storage is the existing GCS bucket via S3-interop. Spec: `docs/superpowers/specs/2026-05-23-staging-postgres-infra-design.md`.

**Tech Stack:** GCP Compute Engine, Cloud Run, IAP, Secret Manager, default VPC; PostgreSQL 16 + pgvector; Drizzle (`pnpm db:migrate`); GitHub Actions.

**Constants used throughout:**
- Project: `vibesboard` (number `319148717246`)
- VM: `vibesboard-staging-pg`, zone `us-central1-a`, machine `e2-micro`
- DB name `vibesboard`; roles `vibesboard_app`, `vibesboard_migrate`
- Cloud Run service `vibesboard-staging` (region `europe-north1`)
- Runtime SA `319148717246-compute@developer.gserviceaccount.com`
- GCS bucket `vibeagent-files-staging`
- IAP range `35.235.240.0/20`

---

## Task 1: Enable required APIs

- [ ] **Step 1: Enable Compute + IAP (Secret Manager/Run already in use)**

```bash
gcloud services enable compute.googleapis.com iap.googleapis.com \
  secretmanager.googleapis.com run.googleapis.com --project vibesboard
```

- [ ] **Step 2: Verify**

Run: `gcloud services list --enabled --project vibesboard --filter="config.name:(compute.googleapis.com OR iap.googleapis.com)" --format="value(config.name)"`
Expected: both `compute.googleapis.com` and `iap.googleapis.com` listed.

---

## Task 2: Firewall rules (default VPC)

- [ ] **Step 1: Confirm default VPC + internal rule**

Run: `gcloud compute networks describe default --project vibesboard --format="value(name)" && gcloud compute firewall-rules list --project vibesboard --filter="network:default AND name:default-allow-internal" --format="value(name)"`
Expected: `default` exists. If `default-allow-internal` is missing, create it in Step 2b.

- [ ] **Step 2a: Allow IAP range to SSH + Postgres**

```bash
gcloud compute firewall-rules create allow-iap-ssh-pg \
  --project vibesboard --network default --direction INGRESS \
  --action ALLOW --rules tcp:22,tcp:5432 \
  --source-ranges 35.235.240.0/20 \
  --target-tags vibesboard-staging-pg
```

- [ ] **Step 2b: Ensure internal traffic can reach 5432 (only if `default-allow-internal` absent)**

```bash
# Run ONLY if Step 1 showed default-allow-internal is missing:
gcloud compute firewall-rules create allow-internal-pg \
  --project vibesboard --network default --direction INGRESS \
  --action ALLOW --rules tcp:5432 \
  --source-ranges 10.128.0.0/9 \
  --target-tags vibesboard-staging-pg
```

- [ ] **Step 3: Verify**

Run: `gcloud compute firewall-rules list --project vibesboard --filter="name:allow-iap-ssh-pg" --format="value(name,sourceRanges.list(),allowed[].map().firewall_rule().list())"`
Expected: rule present, source `35.235.240.0/20`, ports `tcp:22,tcp:5432`.

---

## Task 3: Create the e2-micro VM with a Postgres+pgvector startup script

**Files:**
- Create (locally, transient): `/tmp/pg-startup.sh`

- [ ] **Step 1: Write the startup script** `/tmp/pg-startup.sh`

```bash
cat > /tmp/pg-startup.sh <<'EOS'
#!/usr/bin/env bash
set -euxo pipefail
# Idempotency guard — startup scripts can re-run on reboot.
if [ -f /var/lib/pg-bootstrapped ]; then exit 0; fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg lsb-release
install -d /usr/share/postgresql-common/pgdg
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update
apt-get install -y postgresql-16 postgresql-16-pgvector
# Listen on all interfaces (firewall + pg_hba restrict access); SSL on (Debian
# ships a snakeoil cert and ssl=on by default).
conf=/etc/postgresql/16/main
sed -i "s/^#\?listen_addresses.*/listen_addresses = '*'/" "$conf/postgresql.conf"
# Require SSL from any source (firewall already limits to internal + IAP).
echo "hostssl all all 0.0.0.0/0 scram-sha-256" >> "$conf/pg_hba.conf"
systemctl restart postgresql
touch /var/lib/pg-bootstrapped
EOS
```

- [ ] **Step 2: Create the VM (no external IP, network tag for the firewall)**

```bash
gcloud compute instances create vibesboard-staging-pg \
  --project vibesboard --zone us-central1-a \
  --machine-type e2-micro \
  --image-family debian-12 --image-project debian-cloud \
  --boot-disk-size 30GB --boot-disk-type pd-standard \
  --no-address \
  --tags vibesboard-staging-pg \
  --metadata-from-file startup-script=/tmp/pg-startup.sh
```

- [ ] **Step 3: Verify the VM is RUNNING and Postgres came up**

Run (wait ~90s for startup script):
```bash
gcloud compute instances describe vibesboard-staging-pg --project vibesboard \
  --zone us-central1-a --format="value(status, networkInterfaces[0].networkIP)"
sleep 90
gcloud compute ssh vibesboard-staging-pg --project vibesboard --zone us-central1-a --tunnel-through-iap \
  --command="sudo -u postgres psql -tAc 'select version();' && systemctl is-active postgresql"
```
Expected: status `RUNNING`, an internal IP (note it), `PostgreSQL 16.x`, `active`. (Note the internal IP — it goes into the app `DATABASE_URL`.)

---

## Task 4: Bootstrap database, roles, extension (over IAP SSH)

- [ ] **Step 1: Generate role passwords locally and keep them for Task 6**

```bash
APP_PW=$(openssl rand -hex 24); MIG_PW=$(openssl rand -hex 24)
echo "APP_PW=$APP_PW"; echo "MIG_PW=$MIG_PW"   # capture these for the secrets
```

- [ ] **Step 2: Create DB, roles, grants, extension over IAP SSH**

Mirrors `packages/adapter-postgres/docker/init.sql` (app = NOSUPERUSER under RLS; migrate = BYPASSRLS).

```bash
gcloud compute ssh vibesboard-staging-pg --project vibesboard --zone us-central1-a --tunnel-through-iap \
  --command="sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
CREATE DATABASE vibesboard;
CREATE ROLE vibesboard_app LOGIN PASSWORD '${APP_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE vibesboard_migrate LOGIN PASSWORD '${MIG_PW}' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
\\connect vibesboard
CREATE EXTENSION IF NOT EXISTS vector;
GRANT ALL ON SCHEMA public TO vibesboard_migrate;
GRANT USAGE ON SCHEMA public TO vibesboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vibesboard_migrate IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vibesboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vibesboard_migrate IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO vibesboard_app;
SQL"
```

- [ ] **Step 3: Verify roles + extension**

Run:
```bash
gcloud compute ssh vibesboard-staging-pg --project vibesboard --zone us-central1-a --tunnel-through-iap \
  --command="sudo -u postgres psql -d vibesboard -tAc \"select rolname, rolbypassrls from pg_roles where rolname like 'vibesboard%'; select extname from pg_extension where extname='vector';\""
```
Expected: `vibesboard_app|f`, `vibesboard_migrate|t`, and `vector`.

---

## Task 5: GCS HMAC key for S3-interop

- [ ] **Step 1: Create an HMAC key on the runtime service account**

```bash
gcloud storage hmac create 319148717246-compute@developer.gserviceaccount.com --project vibesboard
```
Output includes `accessId` and `secret` — capture both for Task 6.

- [ ] **Step 2: Verify the bucket is reachable with these creds (path-style S3)**

Run: `gcloud storage ls gs://vibeagent-files-staging --project vibesboard`
Expected: lists the bucket (empty or with objects) without error. (Confirms the bucket exists and the SA can access it.)

---

## Task 6: Secret Manager secrets + IAM

Use the captured values: VM internal IP `<VM_IP>`, `APP_PW`, `MIG_PW`, HMAC `accessId`/`secret`.

- [ ] **Step 1: Create the five secrets**

```bash
BAS=$(openssl rand -hex 32)
printf 'postgres://vibesboard_app:%s@%s:5432/vibesboard?sslmode=require' "$APP_PW" "<VM_IP>" \
  | gcloud secrets create database-url-staging --project vibesboard --data-file=-
printf 'postgres://vibesboard_migrate:%s@localhost:5432/vibesboard?sslmode=require' "$MIG_PW" \
  | gcloud secrets create database-migrate-url-staging --project vibesboard --data-file=-
printf '%s' "$BAS" | gcloud secrets create better-auth-secret-staging --project vibesboard --data-file=-
printf '%s' "<HMAC_ACCESS_ID>" | gcloud secrets create s3-access-key-id-staging --project vibesboard --data-file=-
printf '%s' "<HMAC_SECRET>" | gcloud secrets create s3-secret-access-key-staging --project vibesboard --data-file=-
```

- [ ] **Step 2: Grant the runtime SA access to the new secrets**

```bash
for s in database-url-staging better-auth-secret-staging s3-access-key-id-staging s3-secret-access-key-staging; do
  gcloud secrets add-iam-policy-binding "$s" --project vibesboard \
    --member="serviceAccount:319148717246-compute@developer.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

- [ ] **Step 3: Grant the WIF SA IAP tunnel + compute view (for the migrate step)**

`WIF_SA` is the value of the repo secret `WIF_SERVICE_ACCOUNT` (read from GitHub repo settings or `gh secret`); substitute it below.

```bash
gcloud projects add-iam-policy-binding vibesboard \
  --member="serviceAccount:<WIF_SA>" --role="roles/iap.tunnelResourceAccessor"
gcloud projects add-iam-policy-binding vibesboard \
  --member="serviceAccount:<WIF_SA>" --role="roles/compute.viewer"
# The migrate step also reads database-migrate-url-staging from the runner:
gcloud secrets add-iam-policy-binding database-migrate-url-staging --project vibesboard \
  --member="serviceAccount:<WIF_SA>" --role="roles/secretmanager.secretAccessor"
```

- [ ] **Step 4: Verify secrets exist**

Run: `gcloud secrets list --project vibesboard --filter="name~staging" --format="value(name)"`
Expected: the five `*-staging` secrets present.

---

## Task 7: Wire the CD workflow (staging path only)

**Files:**
- Modify: `.github/workflows/deploy-cloudrun.yml`

The existing `deploy` job authenticates via `./.github/actions/gcp-auth` and deploys per-branch. We add a `migrate` job that runs only for `dev`, and add staging-only env/secrets/VPC-egress to the deploy step (guarded by the existing `github.ref_name == 'main'` ternaries so prod is untouched).

- [ ] **Step 1: Add the `migrate` job (before `deploy`)**

Insert this job into `.github/workflows/deploy-cloudrun.yml` (after the existing `permissions:` block, as a sibling of `deploy`):

```yaml
  migrate:
    # Staging only — prod DB isn't provisioned yet.
    if: github.ref_name == 'dev'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Authenticate to GCP
        uses: ./.github/actions/gcp-auth
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
      - name: Open IAP tunnel to staging Postgres
        run: |
          gcloud compute start-iap-tunnel vibesboard-staging-pg 5432 \
            --local-host-port=localhost:5432 --zone=us-central1-a \
            --project=${{ secrets.GCP_PROJECT_ID }} &
          for i in $(seq 1 30); do (echo > /dev/tcp/localhost/5432) >/dev/null 2>&1 && break; sleep 1; done
      - name: Run migrations
        env:
          DATABASE_MIGRATE_URL: ${{ secrets.STAGING_DATABASE_MIGRATE_URL }}
        run: pnpm db:migrate
```

Note: the migrate URL is read from a **GitHub Actions secret** `STAGING_DATABASE_MIGRATE_URL` (set it in repo settings to the same value as the `database-migrate-url-staging` Secret Manager secret), rather than fetching from Secret Manager in-job — simpler and avoids an extra gcloud call. Add it via:
`gh secret set STAGING_DATABASE_MIGRATE_URL` (paste the localhost migrate URL).

- [ ] **Step 2: Make `deploy` depend on `migrate`**

In the `deploy` job, add at the top (alongside `runs-on`):

```yaml
    needs: [migrate]
```

Because `migrate` has `if: github.ref_name == 'dev'`, it is skipped on `main`; add `if: always() && (needs.migrate.result == 'success' || needs.migrate.result == 'skipped')` to the `deploy` job so prod (where migrate is skipped) still deploys.

- [ ] **Step 3: Add staging env/secrets/VPC-egress to the deploy step**

In the `Deploy to Cloud Run` step's `env_vars:` block, append (these are unconditional — staging values; prod doesn't run Postgres yet but these are harmless there, OR guard with the ternary if preferred):

```yaml
            S3_ENDPOINT=https://storage.googleapis.com
            S3_REGION=us-east-1
            S3_BUCKET=vibeagent-files-staging
            S3_FORCE_PATH_STYLE=false
            BETTER_AUTH_URL=${{ github.ref_name == 'main' && secrets.PROD_NEXT_PUBLIC_APP_URL || secrets.STAGING_NEXT_PUBLIC_APP_URL }}
```

In the `secrets:` block, append (staging secret names; only mounted on staging deploys):

```yaml
            DATABASE_URL=database-url-staging:latest
            BETTER_AUTH_SECRET=better-auth-secret-staging:latest
            S3_ACCESS_KEY_ID=s3-access-key-id-staging:latest
            S3_SECRET_ACCESS_KEY=s3-secret-access-key-staging:latest
```

Add Direct VPC egress + a `flags` input to the `deploy-cloudrun` step (staging only) so the service can reach the VM's private IP:

```yaml
          flags: >-
            ${{ github.ref_name == 'dev' && '--network=default --subnet=default --vpc-egress=private-ranges-only' || '' }}
```

- [ ] **Step 4: Lint the workflow YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-cloudrun.yml')); print('YAML OK')"`
Expected: `YAML OK`.

- [ ] **Step 5: Commit on a feature branch**

```bash
git checkout -b feat/staging-postgres-cd
git add .github/workflows/deploy-cloudrun.yml
git commit -m "ci(staging): provision Postgres data plane in Cloud Run deploy

Add a dev-only migrate job (IAP tunnel + pnpm db:migrate) gating the
deploy, and wire DATABASE_URL/BETTER_AUTH_SECRET/S3 + Direct VPC egress
into the staging Cloud Run service."
```

---

## Task 8: Deploy and verify staging e2e

- [ ] **Step 1: Open a PR and merge to `dev`** (squash, per CLAUDE.md), or push the branch to `dev` if working directly. This triggers `deploy-cloudrun.yml`.

- [ ] **Step 2: Watch the migrate + deploy jobs**

Run: `gh run watch $(gh run list --workflow=deploy-cloudrun.yml --branch=dev --limit=1 --json databaseId --jq '.[0].databaseId')`
Expected: `migrate` job green (migrations applied over the tunnel), then `deploy` job green.

- [ ] **Step 3: Confirm the staging service is serving with DB env**

Run:
```bash
gcloud run services describe vibesboard-staging --project vibesboard --region europe-north1 \
  --format="value(spec.template.spec.containers[0].env[].name)" | tr ';' '\n' | grep -E "DATABASE_URL|BETTER_AUTH_SECRET|S3_BUCKET"
curl -s -o /dev/null -w "%{http_code}\n" "$(gcloud run services describe vibesboard-staging --project vibesboard --region europe-north1 --format='value(status.url)')/"
```
Expected: the env names present; home returns `200` (or a redirect to sign-in).

- [ ] **Step 4: Verify migrations landed on the VM**

Run:
```bash
gcloud compute ssh vibesboard-staging-pg --project vibesboard --zone us-central1-a --tunnel-through-iap \
  --command="sudo -u postgres psql -d vibesboard -tAc \"select count(*) from information_schema.tables where table_schema='public' and table_name in ('tenants','tenant_members','invitations','users');\""
```
Expected: `4` (the identity tables exist).

- [ ] **Step 5: Staging e2e in Chrome** (mirror the local run)

Against the staging URL:
1. Sign up a test user → verify email (check Cloud Run logs for the dev-fallback link if Resend isn't delivering: `gcloud run services logs read vibesboard-staging --project vibesboard --region europe-north1 --limit=50 | grep -i verify`) → sign in.
2. Confirm dashboard loads (personal tenant auto-created on the VM).
3. `POST /api/tenants/create-team` (via the UI or an authenticated `fetch` in the page console) → **201**; duplicate slug → **409**.
4. Seed an invitation directly on the VM (`gcloud compute ssh ... psql` insert into `invitations`) and `POST /api/invitations/<token>/accept` → **200**; re-accept → **410**.
5. Verify rows on the VM via `psql` (over IAP SSH).

- [ ] **Step 6: Record the result + stop the VM if idle (cost hygiene)**

```bash
# Optional: stop the VM when not actively testing (compute billing pauses).
gcloud compute instances stop vibesboard-staging-pg --project vibesboard --zone us-central1-a
```

---

## Notes for the executor

- **Secrets discipline:** the role passwords, HMAC secret, and BETTER_AUTH_SECRET are sensitive. They go only into Secret Manager / GitHub Actions secrets — never echoed into committed files or the workflow YAML. The `echo`/`printf` in Tasks 4/6 are local-shell only.
- **`STAGING_DATABASE_MIGRATE_URL`** GitHub Actions secret must be set (Task 7 Step 1 note) before the first deploy, or the migrate job fails.
- **First deploy ordering:** Tasks 1–6 (provisioning) must complete before Task 8 (deploy), because the deploy mounts the secrets and the migrate job needs the VM.
- **Cross-region latency** (~130 ms/query) makes staging pages slow; expected, not a failure.
- **VM stopped?** If you stopped the VM (Step 6), start it (`gcloud compute instances start ...`) before the next deploy/e2e; cold start ≈ 1–2 min.
