# Staging Postgres Data-Plane Infrastructure — Design

**Date:** 2026-05-23
**Status:** Approved (design); pending spec review
**Scope:** Provision a **free, GCP-native** Postgres for the **staging**
environment and wire the Postgres + Better Auth + S3 data plane into the Cloud
Run CD pipeline, so the Firestore→Postgres migration phases can be deployed and
e2e-tested on real staging. Staging only; prod (`vibeagent` service / `main`
branch) is untouched.

## Background

Staging (`vibesboard-staging` Cloud Run service, project `vibesboard`, region
`europe-north1`) still runs the pre-migration stack: its env has Stripe +
Firebase vars but **no `DATABASE_URL`, no `BETTER_AUTH_SECRET`, no `S3_*`, and no
database attached**. Secret Manager has no DB/Better-Auth/S3 secrets. So the
Postgres data plane has never been deployed to staging — #170 and PR 1a were
only verified locally. This work is the prerequisite for deploying *any*
Postgres phase to staging.

The CD pipeline (`.github/workflows/deploy-cloudrun.yml`) already authenticates
to GCP keylessly via Workload Identity Federation (`.github/actions/gcp-auth`)
and deploys per-branch (`dev`→staging, `main`→prod) via
`google-github-actions/deploy-cloudrun@v2`.

## Goals

- A **$0**, GCP-native Postgres (pgvector-capable) for staging, kept off the
  public internet.
- Automated schema migrations to staging on every deploy.
- Better Auth + S3 wired so the migrated app actually functions on staging.
- e2e verification of PR 1a (and a repeatable path for later phases).

## Non-goals

- Prod (`main`/`vibeagent`) data-plane wiring — separate later effort.
- High availability, managed backups, read replicas.
- Migrating any additional application code (that's the phase PRs).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Postgres host | **Self-managed PostgreSQL 16 + pgvector on an Always-Free `e2-micro` VM** | $0 within GCP's Always Free tier; stays entirely on the GCP account. |
| VM region | **`us-central1`** (Always-Free eligible) | Free tier is US-only (`us-west1`/`us-central1`/`us-east1`). |
| Cloud Run → DB connectivity | **Direct VPC egress** to the VM's **private IP** | No connector cost (free), keeps Postgres off the public internet. |
| Migrations | **Cloud Run Job** (Direct VPC egress) triggered by the deploy workflow | In-network access to the private-IP VM; no public exposure, no IAP-tunnel-in-CI. |
| Object storage | **Existing GCS bucket via S3-interop** (`vibeagent-files-staging`) | Completes the data plane without a new bucket. |
| Scope | **Staging only** | Prod isn't migrated; guard all new wiring to the staging branch path. |

## Cost

- **VM: $0** — `e2-micro` + `us-central1` + ≤30 GB **standard** persistent disk
  is covered by GCP Always Free (auto-waived on the bill).
- Cross-region internal traffic (Cloud Run `europe-north1` ↔ VM `us-central1`)
  is billed at inter-region internal rates (~$0.01/GB) — pennies for staging.
- **Trade-offs accepted:** ~120–150 ms/query cross-region latency (staging pages
  do several queries → noticeably slower than prod, fine for testing); 1 GB RAM
  (tight but workable for light load); self-managed (patching, no managed
  backups).

## Architecture

### The VM (one-time provision)

- `vibesboard-staging-pg`, `e2-micro`, `us-central1-a`, Debian 12, 30 GB
  **standard** persistent disk, **no external IP** (private only; admin via IAP
  SSH).
- A **startup script** installs PostgreSQL 16 + the `postgresql-16-pgvector`
  package, sets `listen_addresses = '*'`, requires SSL, and enables the unit.
- Bootstrap (one-time, over **IAP SSH**) as the `postgres` superuser: create DB
  `vibesboard`; the two roles below + grants (mirroring
  `packages/adapter-postgres/docker/init.sql`); `CREATE EXTENSION vector`.

### Roles (mirror the adapter model)

- **`vibesboard_app`** — `NOSUPERUSER`, subject to RLS; used by the Cloud Run app.
- **`vibesboard_migrate`** — `BYPASSRLS`; used by drizzle-kit / admin scripts.
- Strong generated passwords; SSL required on all connections.

### Networking

- A VPC subnet in **`europe-north1`** for Cloud Run **Direct VPC egress**, and
  the VM on a subnet in **`us-central1`**, both in the same (global) VPC, so
  internal routing reaches the VM's private IP cross-region.
- **Firewall:** allow TCP `5432` to the VM **only from the VPC internal ranges**
  (Cloud Run egress subnet + the migration job). No `0.0.0.0/0`. SSH only via
  IAP (`35.235.240.0/20`).
- The Cloud Run **service** and the migration **job** both attach Direct VPC
  egress to the `europe-north1` subnet.

### Object storage (S3-interop)

`adapter-s3` → existing GCS bucket `vibeagent-files-staging` via
`S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=us-east-1` (the AWS SDK
requires a region string; GCS ignores it), `S3_FORCE_PATH_STYLE=false`, using a
**GCS HMAC key**.

## Secrets (new, Secret Manager — staging)

| Secret | Contents | Consumed by |
|---|---|---|
| `database-url-staging` | App-role connection to the VM **private IP**, `sslmode=require` (`vibesboard_app`) | Cloud Run service |
| `database-migrate-url-staging` | Migrate-role connection to the VM **private IP**, `sslmode=require` (`vibesboard_migrate`) | Migration Cloud Run Job |
| `better-auth-secret-staging` | `openssl rand -hex 32` | Cloud Run service |
| `s3-access-key-id-staging` | GCS HMAC access key id | Cloud Run service |
| `s3-secret-access-key-staging` | GCS HMAC secret | Cloud Run service |

(Both DB URLs target the same VM private IP; they differ only by role. Because
access is over Direct VPC egress, no proxy/tunnel or public exposure is needed.)

### IAM

- **One-time bootstrap** (steps 1–7) runs under the local `gcloud` account
  (`midhunxavier1993@gmail.com`, already has project access) — it creates the
  VM, network, secrets, and migration job, and reaches the VM via IAP SSH.
- **WIF service account** (used by CD) needs `run.developer` to deploy the
  service and execute the migration job, plus `secretmanager.secretAccessor` on
  the five new secrets if it reads them at deploy time.
- **Cloud Run runtime SA** (service + migration job) needs
  `secretmanager.secretAccessor` to mount the secrets at runtime.

## CD workflow changes (`deploy-cloudrun.yml`, staging path only)

1. **Migration step** (only on `dev`): after build/push, `gcloud run jobs
   execute vibesboard-staging-migrate --wait`. The job runs the app image with
   command `pnpm db:migrate`, Direct VPC egress, and `DATABASE_MIGRATE_URL` from
   the secret. The `deploy` step runs only if the job succeeds.
2. **`deploy` job additions**, guarded to staging via the existing
   `github.ref_name == 'main'` ternaries (prod unaffected):
   - `flags:` Direct VPC egress (`--network`/`--subnet` + `--vpc-egress`).
   - `env_vars` += `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET=vibeagent-files-staging`,
     `S3_FORCE_PATH_STYLE=false`.
   - `secrets` += `DATABASE_URL=database-url-staging:latest`,
     `BETTER_AUTH_SECRET=better-auth-secret-staging:latest`,
     `S3_ACCESS_KEY_ID=s3-access-key-id-staging:latest`,
     `S3_SECRET_ACCESS_KEY=s3-secret-access-key-staging:latest`.

The migration **Cloud Run Job** is created once (out of band or via a documented
`gcloud run jobs create`), then re-executed by CD each deploy.

## Execution order (bootstrap, run via `gcloud`)

1. Enable APIs: `compute`, `run`, `iap`, `secretmanager` (as needed).
2. Create the VPC + two subnets (`europe-north1` for Cloud Run egress,
   `us-central1` for the VM) + firewall rules (5432 from internal; IAP SSH).
3. Create the `e2-micro` VM (no external IP) with the Postgres+pgvector startup
   script; 30 GB standard disk.
4. Over IAP SSH: create DB, the two roles + grants, `CREATE EXTENSION vector`.
5. Create the GCS HMAC key for `vibeagent-files-staging`.
6. Create the five Secret Manager secrets; grant IAM.
7. Create the migration Cloud Run Job.
8. Land the `deploy-cloudrun.yml` changes in a PR to `dev`.
9. Push → CD executes the migrate job → deploys → staging live on Postgres.

## Verification (staging e2e in Chrome)

Mirror the local run, against staging:
- Sign up → verify email (Resend secret present → real email; else console
  fallback in Cloud Run logs) → sign in.
- Confirm personal tenant auto-created; create team workspace (201); duplicate
  slug (409); seed + accept an invitation (200); re-accept (410). Verify rows in
  the staging VM's Postgres (over IAP SSH `psql`).

## Ops notes / risks

- **Self-managed:** OS/Postgres patching is on us; no managed backups. Optional
  follow-up: a nightly `pg_dump` to GCS via cron. Staging is wipe-and-reseed, so
  durability is low-stakes.
- **1 GB RAM:** pgvector similarity queries will be slow; acceptable for staging.
- **Cross-region latency** (~130 ms/query) makes staging pages slower than prod.
  If it becomes annoying, colocating staging Cloud Run in `us-central1` (or
  paying ~$8/mo for a VM in `europe-north1`) is the lever — out of scope now.
- **Rollback:** a failed migration job blocks the deploy. Migrations are
  forward-only; disposable staging data means no unwind.
- **Secret hygiene:** connection strings (with role passwords) live only in
  Secret Manager; Postgres is private-IP + SSL-required, never public.

## Out-of-scope follow-ups

- Prod (`main`/`vibeagent`) Postgres provisioning + CD wiring.
- Automated backups / durability if staging ever needs it.
- Colocation/region tuning if cross-region latency is a problem.
