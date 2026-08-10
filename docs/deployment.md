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

## Secrets

`scripts/setup-secrets.sh` can seed the older shared Secret Manager names from a
local env file, but the CI workflow also expects environment-specific database,
auth, and storage secrets. See [`configuration.md`](configuration.md) for what
each value does.

> **Careful with Secret Manager versions.** Secrets mounted as
> `versions/latest` resolve on cold start. Disabling a version that is still
> mounted will crash-loop the service the next time it cold-starts, which can
> surface as a delayed outage rather than an immediate one.

## Legacy script

`deploy-cloud-run.sh` is a legacy manual path and is **not** aligned with the
current PostgreSQL/S3/Better Auth deployment. It omits required runtime secrets
and still carries legacy GCS/Stripe configuration. Use the GitHub Actions
workflow until that script is brought back in sync.

## Self-hosting elsewhere

The application builds to a standalone Next.js output and runs anywhere that can
provide:

- PostgreSQL with the `pgvector` extension, and the `vibesboard_app` /
  `vibesboard_migrate` roles described in [`architecture.md`](architecture.md);
- S3-compatible object storage;
- the environment described in [`configuration.md`](configuration.md).

The repository ships a [`Dockerfile`](../Dockerfile) and a
[`docker-compose.dev.yml`](../docker-compose.dev.yml) for local infrastructure.
