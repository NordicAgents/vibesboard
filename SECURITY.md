# Security Policy

## Reporting a vulnerability

**Please do not report security issues through public GitHub issues, pull
requests, or discussions.** A public report tells everyone running Vibesboard
about the problem at the same moment it tells us, including the people who would
misuse it.

Report privately in one of two ways:

1. **GitHub private vulnerability reporting** — preferred. Open the
   [Security tab](https://github.com/NordicAgents/vibesboard/security) of this
   repository and choose **Report a vulnerability**. This creates a private
   thread visible only to you and the maintainers.
2. **Email** — <hi@vibesboard.com>, with `SECURITY` in the subject line.

Please include:

- What the issue is and which component it affects
- Steps to reproduce, ideally a minimal proof of concept
- The version, commit, or deployment you tested against
- What an attacker could do with it

If you would like credit in the advisory, tell us the name or handle to use.

## What to expect

- **Acknowledgement** within 3 business days.
- **An initial assessment** — whether we can reproduce it, and how we rate the
  severity — within 10 business days.
- **Updates** as the fix progresses, and a note when it ships.

We will let you know if we decide an issue is out of scope or is working as
intended, and why. We ask that you give us a reasonable window to ship a fix
before disclosing publicly.

We do not currently run a paid bug bounty.

## Scope

Vibesboard is self-hosted software, so what matters here is the code in this
repository. The following are in scope:

- Cross-tenant data access — anything that lets one workspace read, modify, or
  infer another workspace's data. This is the property the platform is built to
  guarantee, and we treat breaks in it as the most serious class of bug.
- Authentication and session handling
- Privilege escalation between roles, or into the admin panel
- Exposure or decryption of stored provider credentials
- Server-side request forgery through agent tools, webhooks, or model endpoints
- Injection, path traversal, or unsafe file handling in ingestion and uploads
- Remote code execution

Out of scope:

- Findings that require an already-compromised host, database, or admin account
- Vulnerabilities in a deployment's own misconfiguration — for example secrets
  committed to your fork, a database exposed to the internet, or a missing
  reverse-proxy TLS setup
- Reports from automated scanners with no demonstrated impact
- Denial of service through sheer request volume
- Missing hardening headers with no exploitable consequence
- Social engineering, physical attacks, and spam or phishing of the project's
  own accounts

Prompt injection deserves its own note. An agent that can be talked into saying
something its operator dislikes is a configuration and prompt-design matter, and
is out of scope. An agent that can be talked into crossing a security boundary —
reaching another tenant's data, invoking a tool it was never granted, or
returning stored credentials — is in scope, and we want to hear about it.

## Supported versions

Vibesboard is pre-1.0 and moves quickly. Fixes land on `main`, and releases are
cut from it with [release-please](https://github.com/googleapis/release-please);
there are no long-term support branches and no backports to older versions. If
you self-host, track `main` or the latest release from it — a fix reported
against an older commit will be answered against current `main`.

## For self-hosters

Most real-world incidents in a self-hosted deployment come from configuration
rather than code. Before you go to production:

- Generate fresh secrets. Never reuse a value from `.env.example`.
- Keep `.env` out of version control — the shipped `.gitignore` already does this.
- Put the app behind TLS and do not expose Postgres or MinIO to the internet.
- Restrict who holds superadmin, and review that list periodically.
- Rotate provider credentials on the schedule your own policy requires.

[`docs/security.md`](docs/security.md) describes the tenancy model and the
isolation guarantees in more detail.
