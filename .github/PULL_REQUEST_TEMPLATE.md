## What this changes

<!-- A short description of the change and the problem it solves. Link the issue
     it closes, e.g. "Closes #123". -->

## Why

<!-- Why this approach? If you considered and rejected an alternative, say so —
     it saves the reviewer from suggesting it. -->

## How it was verified

<!-- Name what you actually ran and what it proved. "Added a test in
     packages/agents/…​ that failed before the fix and passes after" is far more
     useful than "tests pass". Include screenshots for UI changes. -->

## Checklist

- [ ] Targets `dev` (not `main`)
- [ ] Title follows Conventional Commits — `feat(scope): …`, `fix(scope): …`, `chore(scope): …`
- [ ] `bun run lint`, `bun run format:check`, and `bun run type-check` are clean
- [ ] Tests cover the change, and were written before or alongside the fix
- [ ] No secrets, credentials, or real customer data in the diff

## Tenant isolation

<!-- Delete this section if the change does not touch data access. -->

- [ ] Every new query is scoped to a tenant, or is deliberately global and says so
- [ ] A test proves one workspace cannot reach another's data through this path

## Anything else

<!-- Migrations that need care on deploy, new environment variables, follow-up
     work you deliberately left out, or anything a reviewer should watch for. -->
