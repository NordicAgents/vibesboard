# Vibesboard roadmap

Vibesboard is currently a **pre-1.0 public beta**. It is useful for evaluation,
internal tools, and carefully operated self-hosted deployments, but APIs,
database schemas, provider adapters, and deployment requirements may change
without a long-term compatibility promise.

## Supported boundary today

- The maintained deployment path is Cloud Run with PostgreSQL and
  S3-compatible object storage. The repository's Docker Compose stack is for
  development and local evaluation.
- The MIT-licensed core includes the agent runtime, workspace isolation,
  knowledge and memory features, model routing, usage metering, and the web and
  messaging integrations described in the documentation.
- The `ee/` directory is optional commercial code governed by [`ee/LICENSE`](ee/LICENSE).
- Self-hosters are responsible for their infrastructure, TLS, network exposure,
  backups, secret management, provider agreements, retention settings, and
  legal compliance. See [`SECURITY.md`](SECURITY.md) and the self-hosting docs.

## Public-beta priorities

1. Complete an independent security review focused on tenant isolation, RLS
   boundaries, admin privilege separation, SSRF, webhooks, uploads, and
   encrypted credentials.
2. Keep the end-to-end isolation, authentication, integration, and deployment
   test suites reliable on every supported release.
3. Document the Cloud Run deployment path, operational prerequisites, backup and
   restore expectations, and the limits of alternative self-hosting topologies.
4. Improve observability, rate limiting, abuse controls, data deletion/export,
   and upgrade guidance for real deployments.
5. Stabilise the public API and configuration surface before committing to a
   1.0 compatibility policy.

## What is experimental

Treat new integrations, provider adapters, memory/re-embedding behaviour,
enterprise billing, and undocumented API routes as experimental until their
documentation and upgrade story say otherwise. A passing build does not make a
feature production-ready; validate the provider, failure modes, quotas, and
data-retention implications in your own environment.

## 1.0 bar

The project will call itself 1.0 only after the maintainers can publish a
supported compatibility policy, complete the independent security review,
document operational recovery procedures, and demonstrate the maintained
deployment path with repeatable release and upgrade testing.

