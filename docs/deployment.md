# Deployment

## Google Cloud Run (maintained path)

The maintained deployment path is
[`.github/workflows/deploy-cloudrun.yml`](../.github/workflows/deploy-cloudrun.yml).
A push to `dev` deploys staging; a push to `main` deploys production.

The workflow:

1. opens an IAP tunnel and applies database migrations;
2. builds and pushes the standalone Next.js image to Artifact Registry;
3. deploys it to Cloud Run with VPC access, environment-specific secrets,
   PostgreSQL, and S3 configuration.

Authentication uses Workload Identity Federation. The container listens on port
`8080` and runs as the non-root `nextjs` user.

The Workload Identity provider condition must match
`assertion.repository == 'NordicAgents/vibesboard'`. Repository renames do not
update that condition automatically.

The workflow uses GitHub deployment environments: `dev` may deploy only to
`staging`, and `main` may deploy only to `production`. Configure required
reviewers for production after the repository is public or the organisation
plan supports environment reviewers.

### Repository variables

Environment-specific resource names live in GitHub **Actions variables**
(Settings → Secrets and variables → Actions → Variables), not in the tracked
workflow, so the repository carries no map of any particular deployment. The
workflow fails with a named error if one is missing. Required:

| Variable                  | Meaning                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `CLOUD_RUN_REGION`        | Region the Cloud Run service deploys to                    |
| `PG_VM_ZONE`              | Zone of the Postgres compute VMs                           |
| `PROD_PG_VM_NAME`         | Name of the production Postgres VM (IAP tunnel target)     |
| `STAGING_PG_VM_NAME`      | Name of the staging Postgres VM (IAP tunnel target)        |
| `PROD_S3_BUCKET`          | Production storage bucket                                  |
| `STAGING_S3_BUCKET`       | Staging storage bucket                                     |
| `NOTIFICATION_EMAIL_FROM` | From-header for notification email, e.g. `App <no-reply@…>` |
| `MONTHLY_MESSAGE_LIMIT`   | Optional soft monthly workspace message cap; blank means unlimited |

Credentials and endpoints (WIF provider, project id, database URLs, app URLs)
remain in Actions **secrets**, as before.

## Secrets

Every runtime credential is environment-scoped. Provision the expected names
from separate files before merging a deployment change:

```bash
./scripts/setup-secrets.sh staging .env.staging
./scripts/setup-secrets.sh production .env.production
```

The script creates names ending in `-staging` or `-prod`. Never seed both from
the same credential file. Provider credentials that must be created in a vendor
dashboard (for example OpenAI or Google OAuth) should be rotated there first,
then added to the appropriate env file and Secret Manager environment.

> **Careful with Secret Manager versions.** Secrets mounted as
> `versions/latest` resolve on cold start. Disabling a version that is still
> mounted will crash-loop the service the next time it cold-starts, which can
> surface as a delayed outage rather than an immediate one.

## Self-hosting elsewhere

The application builds to a standalone Next.js output and runs anywhere that can
provide:

- PostgreSQL with the `pgvector` extension, and the `vibesboard_app` /
  `vibesboard_migrate` roles described in [`architecture.md`](architecture.md);
- S3-compatible object storage;
- the environment described in [`configuration.md`](configuration.md).

The repository ships a [`Dockerfile`](../Dockerfile) and a
[`docker-compose.dev.yml`](../docker-compose.dev.yml) for local infrastructure.
