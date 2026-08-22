# @vibesboard/adapter-better-auth

Better Auth identity layer for Vibesboard, wired to Postgres via
`@vibesboard/adapter-postgres`. Provides Google OAuth, email + password, and
magic-link sign-in, plus the email senders and account-lifecycle helpers the
app needs.

## What it provides

- Google OAuth (enabled only when both `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`
  are set), email + password (with email verification), and magic-link sign-in.
- A Drizzle adapter pointed at the existing `users`/`sessions`/`accounts`/
  `verifications` tables (`provider: 'pg'`, `usePlural: true`).
- An `onUserCreateAfter` hook that auto-creates a personal tenant + a
  `TENANT_ADMIN` `tenant_members` row when a new user signs up (idempotent on
  existing membership).
- Email senders backed by Resend, with a console-logging fallback when
  `RESEND_API_KEY` is unset.

## Usage

This is a private workspace package; depend on it via `workspace:*` rather than
installing from a registry. It exports everything from the package root:

```ts
import {
  auth,
  type Auth,
  onUserCreateAfter,
  sendMagicLinkEmail,
  sendVerifyEmail,
  sendResetPasswordEmail,
  resolveUserIdByGoogleSub,
  revokeUserSessions,
  setUserDisabled,
  isUserDisabled,
} from "@vibesboard/adapter-better-auth";
```

## Environment variables

| Variable                 | Required | Notes                                                                                              |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`     | Prod     | Server-side session signing. Required in production (throws if unset); dev falls back to a placeholder. |
| `NEXT_PUBLIC_APP_URL`    | No       | Base URL for auth callbacks. Defaults to `http://localhost:3000`.                                  |
| `AUTH_GOOGLE_ID`         | No       | Google OAuth client ID. Google sign-in is enabled only when this and the secret are both set.      |
| `AUTH_GOOGLE_SECRET`     | No       | Google OAuth client secret.                                                                        |
| `RESEND_API_KEY`         | No       | Resend API key for email sends. When unset, senders console-log instead.                           |
| `NOTIFICATION_EMAIL_FROM`| No       | From-address for outbound email. Defaults to `Vibesboard <noreply@example.com>`.                   |

`auth` is configured via `src/config.ts`; the Resend-backed email senders live
in `src/email.ts`.
