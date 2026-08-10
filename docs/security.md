# Security

Vibesboard is multi-tenant. Workspace isolation is enforced in the database, not
only in application code.

## Tenant isolation

- Tenant-owned tables use PostgreSQL row-level security and **fail closed**
  without tenant context — a query issued outside `withTenant`/`withDb` returns
  no rows rather than leaking across workspaces.
- Two database roles are used: `vibesboard_app` (RLS enforced, normal requests)
  and `vibesboard_migrate` (`BYPASSRLS`, migrations and trusted admin work).
- Keep `DATABASE_MIGRATE_URL` out of normal request code; it bypasses tenant RLS
  by design.

See [`architecture.md`](architecture.md) for the connection model.

## Credentials

- Tenant provider keys, OAuth tokens, and channel credentials are encrypted at
  rest with `ENCRYPTION_KEY` before storage, and are never returned by read APIs.
- `BETTER_AUTH_SECRET` signs sessions and is required in production.
- `ACCESS_GATE_SECRET` hashes public-agent access passwords and signs access
  cookies.

## Outbound request validation

Tenant-supplied provider and webhook URLs are validated to reduce SSRF exposure.
Private hosts require an explicit tenant opt-in or a host allowlist. Custom
provider URLs are validated both at save time and again before runtime use.

## Automated scanning

CI runs Semgrep SAST, a Trivy filesystem vulnerability scan (CRITICAL and HIGH),
and Lizard complexity analysis on pull requests and pushes to `dev` and `main`.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

<!-- TODO: add the security contact address or GitHub Security Advisory link,
     and promote this section to a top-level SECURITY.md. -->
