# Staging Postgres Data-Plane Infrastructure — Design

**Date:** 2026-05-23
**Status:** Approved (design); pending spec review
**Scope:** Provision a managed Postgres for the **staging** environment and wire
the Postgres + Better Auth + S3 data plane into the Cloud Run CD pipeline, so
the Firestore→Postgres migration phases can be deployed and e2e-tested on real
staging. Staging only; prod (`vibeagent` service / `main` branch) is untouched.

## Background

Staging (`vibesboard-staging` Cloud Run service, project `vibesboard`, region
`europe-north1`) still runs the pre-migration stack: its env has Stripe +
Firebase vars but **no `DATABASE_URL`, no `BETTER_AUTH_SECRET`, no `S3_*`, and no
Cloud SQL instance attached**. The Cloud SQL Admin API is not even enabled on
the project, and Secret Manager has no DB/Better-Auth/S3 secrets. So the Postgres
data plane has never been deployed to staging — #170 and PR 1a were only verified
locally. This work is the prerequisite for deploying *any* Postgres phase to
staging.

The CD pipeline (`.github/workflows/deploy-cloudrun.yml`) already authenticates
to GCP keylessly via Workload Identity Federation (`.github/actions/gcp-auth`)
and deploys per-branch (`dev`→staging, `main`→prod) using
`google-github-actions/deploy-cloudrun@v2`.

## Goals

- A reachable, cheap managed Postgres (pgvector-capable) for staging.
- Automated schema migrations to staging on every deploy.
- Better Auth + S3 wired so the migrated app actually functions on staging.
- e2e verification of PR 1a (and a repeatable path for later phases).

## Non-goals

- Prod (`main`/`vibeagent`) data-plane wiring — separate later effort.
- High availability, PITR, read replicas — not needed for staging.
- Migrating any additional application code (that's the phase PRs).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Postgres host | **Cloud SQL for PostgreSQL** | Native GCP, keyless via the Cloud SQL connector + WIF + Secret Manager; pgvector supported. |
| Instance size | **db-f1-micro**, single zone, no HA/PITR, backups off | Cheapest tier; staging is light-load. Stop-when-idle to save cost. |
| Migrations | **Automated step in the deploy workflow** | Schema stays in sync on every push to `dev`; no drift, no manual step. |
| Object storage | **Existing GCS bucket via S3-interop** (`vibeagent-files-staging`) | Completes the data plane without a new bucket; `adapter-s3` targets GCS over its S3 API. |
| Scope | **Staging only** | Prod isn't migrated; guard all new wiring to the staging branch path. |

## Architecture

### Cloud SQL instance (one-time provision)

- Name `vibesboard-staging-pg`, PostgreSQL 16, **db-f1-micro**, single zone
  `europe-north1`, 10 GB SSD, no HA, no PITR, backups off. Requires enabling
  `sqladmin.googleapis.com`.
- Enable the `vector` extension (pgvector) for the RAG phases.

### Database, roles, extension (one-time bootstrap)

Via the Cloud SQL Auth Proxy + `psql` as the default `postgres` superuser:

- Database `vibesboard`.
- Two roles mirroring `packages/adapter-postgres/docker/init.sql`:
  - **`vibesboard_app`** — `NOSUPERUSER`, subject to RLS; used by the Cloud Run
    app and workers.
  - **`vibesboard_migrate`** — `BYPASSRLS`; used by drizzle-kit + admin scripts.
- Grants matching the dev `init.sql`; `CREATE EXTENSION IF NOT EXISTS vector`.

### Connectivity

- **Cloud Run → Cloud SQL:** native connector via
  `--add-cloudsql-instances=vibesboard:europe-north1:vibesboard-staging-pg`
  (unix socket, keyless; no VPC connector). The app `DATABASE_URL` uses the
  socket form (`host=/cloudsql/<connection-name>`) as `vibesboard_app`.
- **GitHub runner → Cloud SQL (migration step):** Cloud SQL Auth Proxy, authed
  via the WIF service account; `DATABASE_MIGRATE_URL` points at `127.0.0.1:5432`
  (proxy) as `vibesboard_migrate`.

### Object storage (S3-interop)

`adapter-s3` → existing GCS bucket `vibeagent-files-staging` via
`S3_ENDPOINT=https://storage.googleapis.com`, `S3_REGION=us-east-1` (the AWS SDK
requires a region string; GCS ignores it), `S3_FORCE_PATH_STYLE=false`, using a
**GCS HMAC key** on the storage service account.

## Secrets (new, Secret Manager — staging)

| Secret | Contents | Consumed by |
|---|---|---|
| `database-url-staging` | App-role connection, **unix-socket form** (`vibesboard_app`) | Cloud Run runtime |
| `database-migrate-url-staging` | Migrate-role connection, **TCP form** (`127.0.0.1:5432` via proxy, `vibesboard_migrate`) | CD migration step |
| `better-auth-secret-staging` | `openssl rand -hex 32` | Cloud Run runtime |
| `s3-access-key-id-staging` | GCS HMAC access key id | Cloud Run runtime |
| `s3-secret-access-key-staging` | GCS HMAC secret | Cloud Run runtime |

Two DB URLs because Cloud Run reaches Postgres over a unix socket while the
GitHub runner reaches it over the Auth Proxy on TCP localhost.

### IAM

The WIF service account gets `roles/cloudsql.client` (migration step + Cloud Run
runtime) and `secretmanager.secretAccessor` on the five new secrets.

## CD workflow changes (`deploy-cloudrun.yml`, staging path only)

1. **New `migrate` job**, runs before `deploy`, only on `dev`:
   - checkout → `pnpm install` → start Cloud SQL Auth Proxy (WIF auth) →
     `pnpm db:migrate` with `DATABASE_MIGRATE_URL` from `database-migrate-url-staging`.
   - The `deploy` job declares `needs: [migrate]`, so a failed migration blocks
     the deploy.
2. **`deploy` job additions**, guarded to staging via the existing
   `github.ref_name == 'main'` ternaries (prod unaffected):
   - `flags: --add-cloudsql-instances=vibesboard:europe-north1:vibesboard-staging-pg`
   - `env_vars` += `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET=vibeagent-files-staging`,
     `S3_FORCE_PATH_STYLE=false`
   - `secrets` += `DATABASE_URL=database-url-staging:latest`,
     `BETTER_AUTH_SECRET=better-auth-secret-staging:latest`,
     `S3_ACCESS_KEY_ID=s3-access-key-id-staging:latest`,
     `S3_SECRET_ACCESS_KEY=s3-secret-access-key-staging:latest`

## Execution order (bootstrap)

1. `gcloud services enable sqladmin.googleapis.com`.
2. Create the `vibesboard-staging-pg` instance.
3. Proxy + `psql`: create DB, the two roles + grants, `CREATE EXTENSION vector`.
4. Create the GCS HMAC key for `vibeagent-files-staging`.
5. Create the five Secret Manager secrets; grant the WIF SA `cloudsql.client`
   + `secretAccessor`.
6. Land the `deploy-cloudrun.yml` changes in a PR to `dev`.
7. Push → CD migrates → deploys → staging live on Postgres.

## Verification (staging e2e in Chrome)

Mirror the local run, against staging:
- Sign up → verify email (Resend secret already present → real email; otherwise
  console fallback in Cloud Run logs) → sign in.
- Confirm personal tenant auto-created; create team workspace (201); duplicate
  slug (409); seed + accept an invitation (200); re-accept (410). Verify rows in
  the staging Cloud SQL DB.

## Ops notes / risks

- **No auto-pause:** Cloud SQL can't suspend like Neon. Stop the instance
  manually when idle (compute billing stops; ~$0.25/mo storage remains);
  restart ≈ 1–2 min cold start. (Accepted: cheapest tier + manual stop.)
- **Rollback:** a failed migrate job blocks the deploy. Migrations are
  forward-only; staging is wipe-and-reseed, so no data to unwind.
- **db-f1-micro is small:** pgvector similarity queries will be slow under load;
  acceptable for staging. Resize later if needed.
- **Bootstrap needs superuser:** role/DB/extension creation runs once via the
  proxy as `postgres`, outside CD (CD's migrate role is BYPASSRLS but not
  superuser).
- **Secret hygiene:** connection strings contain role passwords; they live only
  in Secret Manager, never in the workflow YAML or repo.

## Out-of-scope follow-ups

- Prod (`main`/`vibeagent`) Postgres provisioning + CD wiring, when prod is
  migrated.
- Backups/PITR/HA if staging ever needs durability.
