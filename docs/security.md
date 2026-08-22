# Security

Vibesboard is multi-tenant. Workspace isolation is enforced with a combination
of application-level tenant scoping and PostgreSQL row-level security.

## Tenant isolation

- Tenant-owned tables define PostgreSQL row-level security policies that **fail
  closed** without tenant context — a query issued through the RLS-enforced role
  outside `withTenant`/`withDb` returns no rows rather than leaking across
  workspaces.
- Two database roles exist: `vibesboard_app` (RLS enforced) and
  `vibesboard_migrate` (`BYPASSRLS`, for migrations and trusted admin work).
- **Current caveat, being addressed:** a number of request paths still run
  through the `vibesboard_migrate` (`BYPASSRLS`) connection, so today
  application-level tenant checks (ownership/membership guards such as
  `canEditAgent` and explicit tenant predicates) are the primary isolation
  boundary on those paths, with RLS as defence in depth rather than the sole
  guarantee. Moving ordinary request traffic fully onto the RLS-enforced role is
  tracked work. Do not treat RLS alone as sufficient when adding a new
  tenant-scoped query — include an explicit tenant check.
- Keep `DATABASE_MIGRATE_URL` out of new request code; it bypasses tenant RLS by
  design.

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

CI runs Gitleaks secret detection, Semgrep SAST, a Trivy filesystem vulnerability
scan (CRITICAL and HIGH), and Lizard complexity analysis on pull requests and
pushes to `dev` and `main`.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.
Use GitHub private vulnerability reporting or email `hi@vibesboard.com` as
described in the top-level [`SECURITY.md`](../SECURITY.md).
