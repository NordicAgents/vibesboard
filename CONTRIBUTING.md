# Contributing to Vibesboard

Thanks for taking the time to contribute. This document covers how to get the
project running, what the review process looks like, and the checks your pull
request has to pass.

## Before you start

For anything larger than a bug fix or a small correction, open an issue first
and describe what you want to change. It is much cheaper to agree on an approach
in an issue than to discover a mismatch after the code is written.

For security problems, do **not** open an issue. Follow
[`SECURITY.md`](SECURITY.md) instead.

## Development setup

Requirements:

- [Bun](https://bun.sh) 1.2.18
- Node.js 22
- Docker with Compose
- An OpenAI API key for the platform fallback model

```bash
git clone https://github.com/<your-fork>/vibeagent.git
cd vibeagent

cp .env.example .env
# Edit .env and replace the placeholder credentials and secrets.

bun install
bun run db:setup   # starts Postgres, Adminer, MinIO; migrates and seeds
bun run dev
```

The app comes up on <http://localhost:3000>. Never commit `.env` — it holds
credentials for your database and any external providers.
[`docs/development.md`](docs/development.md) has the full command reference and
[`docs/configuration.md`](docs/configuration.md) explains every variable.

## Making a change

Branch from `dev`, not `main`:

```bash
git checkout dev && git pull
git checkout -b feat/short-description
```

Write tests before the implementation. This codebase is a multi-tenant SaaS, so
tenant isolation is a correctness requirement rather than a nice-to-have — if
your change touches data access, add a test that proves one workspace cannot
reach another's rows.

When you are debugging something non-obvious, find the root cause rather than
patching the symptom. A fix that makes a test pass without explaining the
original failure usually moves the bug rather than removing it.

## Commit messages

The project releases with [release-please](https://github.com/googleapis/release-please),
which reads [Conventional Commits](https://www.conventionalcommits.org/) to
decide version bumps and build the changelog. Use:

```
feat(scope): add per-agent model routing
fix(scope): stop leaking the tenant id into the widget payload
chore(scope): bump drizzle to 0.44
```

`feat` and `fix` appear in the changelog; `chore`, `docs`, `test`, and `refactor`
do not trigger a release.

## Checks your PR must pass

Run these locally before you push — they are the same gates CI applies:

```bash
bun run lint
bun run format:check
bun run type-check
bun run test           # requires `bun run db:up && bun run db:migrate` first
```

CI additionally runs two Playwright suites and a production build. Both E2E
suites run from `apps/web`, and both stub the model at the network boundary with
a mock OpenAI server, so they need no API key:

```bash
cd apps/web
bun run test:e2e         # specs directly under e2e/
bun run test:e2e:local   # the deep suite under e2e/local/
```

See [`docs/local-e2e.md`](docs/local-e2e.md) for running the deep suite locally,
including the path that does not need Docker. The E2E suites are heavy; letting
CI run them is usually the better trade unless you are actively changing them.

The security workflow (Semgrep, Trivy, and a complexity gate) also runs on every
pull request.

### A note on forks

GitHub does not give pull requests from forks access to repository secrets. The
build job falls back to public defaults so it still compiles, but jobs that
depend on a configured integration may behave differently on your fork than on a
branch in this repository. If a check fails in a way that looks unrelated to your
change, say so in the PR and a maintainer will take a look.

## Pull requests

- Target `dev`. Only maintainers open `dev` → `main` release PRs.
- Keep the PR focused on one thing. Unrelated cleanups are welcome, as a separate PR.
- Fill in the template: what changed, why, and how you verified it.
- Explain what you actually ran. "Tests pass" is less useful than naming the
  suite and the case that used to fail.

Feature branches are squash-merged into `dev`, so you do not need to tidy your
intermediate commits — but the PR title becomes the commit message, so it should
follow the conventional-commit format above.

## Licensing of contributions

Vibesboard is released under the [MIT License](LICENSE). By submitting a pull
request you agree that your contribution is licensed under those same terms, and
that you have the right to license it — that it is your own work, or that you
have permission from whoever owns it.
