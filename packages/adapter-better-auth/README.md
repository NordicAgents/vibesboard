# @vibesboard/adapter-better-auth

Better Auth identity layer for Vibesboard self-host, wired to Postgres
via `@vibesboard/adapter-postgres`.

## Status

Sub-project #2 of the Firebase → Postgres/S3/Auth migration. See the
[design spec](../../docs/superpowers/specs/2026-05-17-adapter-better-auth-design.md).

## What it provides

- Google OAuth, email + password, magic link sign-in
- Drizzle adapter pointed at our existing users/sessions/accounts/verifications tables
- An `onUserCreate` hook that auto-creates a personal tenant + TENANT_ADMIN
  tenant_members row when a new user signs up
- Email senders backed by Resend (or console-logging fallback when
  RESEND_API_KEY is unset)
