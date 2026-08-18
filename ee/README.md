# Enterprise Edition

**The contents of this directory are not MIT licensed.** They are governed by
[`ee/LICENSE`](./LICENSE) — the Vibesboard Enterprise Edition licence. Everything
outside this directory is MIT (see the [root LICENSE](../LICENSE)).

This mirrors how [PostHog](https://github.com/PostHog/posthog) (`ee/`) and
[Chatwoot](https://github.com/chatwoot/chatwoot) (`enterprise/`) structure the
same problem: one public repository, two licences, a directory boundary between
them.

## What you may and may not do

You may read, modify, and run this code **for development and testing**, without
a subscription. Running it **in production** requires a valid Vibesboard
Enterprise Edition subscription. You may not copy, publish, distribute,
sublicense, or sell it. Read `LICENSE` in this directory for the actual terms —
this paragraph is a summary, not the licence.

## What lives here

| Directory | Status | Contents |
|---|---|---|
| `billing/` | skeleton | Subscription resolution, plan configuration, Stripe (Phase 2) |
| `sso/` | planned | SAML and OIDC workspace login |
| `audit/` | planned | Tenant-scoped audit log |
| `rbac/` | planned | Custom roles beyond owner/admin/member |

What deliberately **stays** in the MIT core: multi-tenancy and workspace
isolation (Postgres RLS), membership and invitations, the owner/admin/member
roles, usage metering, and the feature-flag system. The tenant boundary is core;
only the governance of that boundary is enterprise. PostHog and Chatwoot draw
the line in the same place — a self-hoster gets the same tenancy model a paying
customer does.

## Running without it

The community edition is the default. Nothing here is loaded unless
`VIBESBOARD_EDITION=enterprise` is set, and `DISABLE_ENTERPRISE=true` overrides
even that.

You can also delete this directory outright:

```bash
rm -rf ee/
bun install && bun run build
```

That is a supported configuration, not a hack — the root licence says "if that
directory exists" for exactly this reason. `apps/web/next.config.mjs` resolves
the enterprise module to an MIT stub when `ee/billing` is absent, and CI proves
it on every pull request (`.github/workflows/ci-community-build.yml`).
