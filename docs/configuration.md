# Configuration

Start from [`.env.example`](../.env.example). Generate local secrets with
`openssl rand -hex 32`.

## Platform AI

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Platform fallback key used when a workspace has no applicable provider configuration |
| `OPENAI_MODEL` | Default chat model |
| `OPENAI_VISION_MODEL` | Optional model override for vision tasks |
| `OPENAI_AGENT_CREATOR_MODEL` | Optional model override for the agent-creation assistant |
| `OPENAI_EMBEDDINGS_MODEL` | Optional OpenAI embedding-model override |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible gateway, proxy, or test endpoint |
| `GOOGLE_EMBEDDING_MODEL` | Optional Google embedding-model override for tenant Google providers |

Workspace administrators configure provider keys and task routing in
**Settings → LLM Providers**. Supported provider kinds are `openai`,
`anthropic`, `google`, `nvidia`, and `openai_compatible`; no provider-specific
tenant keys belong in the process environment. See [`byo-llm.md`](byo-llm.md).

## Application and auth

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Canonical application URL and auth callback base |
| `BETTER_AUTH_SECRET` | Server-side session signing secret; required in production |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` | Enable Google sign-in when both are set |
| `RESEND_API_KEY` | Email delivery for verification, password reset, magic links, and notifications |
| `NOTIFICATION_EMAIL_FROM` | Sender identity for application email |
| `ACCESS_GATE_SECRET` | Hashes public-agent access passwords and signs access cookies |

`NEXT_PUBLIC_AUTH_GOOGLE` is retained as a build argument but is not read by
application code. Google OAuth is enabled only by `AUTH_GOOGLE_ID` and
`AUTH_GOOGLE_SECRET`.

### Supported sign-in methods

- **Google OAuth** when `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are set.
- **Email and password** with mandatory email verification.
- **Magic links** through the same Resend integration.

Without `RESEND_API_KEY`, development email URLs are written to the server
console. Production deployments should always configure a real mail provider and
a strong `BETTER_AUTH_SECRET`.

## Data and storage

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | RLS-enforced application connection |
| `DATABASE_MIGRATE_URL` | Privileged migration/admin connection |
| `DATABASE_POOL_MAX` | Optional application pool size; defaults to `10` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET` | S3-compatible storage location |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Storage credentials |
| `S3_FORCE_PATH_STYLE` | Use `true` for local MinIO and `false` for virtual-hosted production services |
| `ENCRYPTION_KEY` | Encrypts tenant provider, OAuth, and channel credentials at rest |

## Integrations

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Calendar OAuth and the default credentials for Google Sheets OAuth |
| `GOOGLE_SHEETS_CLIENT_ID`, `GOOGLE_SHEETS_CLIENT_SECRET` | Optional dedicated Google Sheets OAuth credentials |
| `VERIFY_TOKEN`, `META_APP_SECRET` | Meta webhook verification and signature validation |
| `WHATSAPP_INBOX_VERIFY_TOKEN`, `INSTAGRAM_INBOX_VERIFY_TOKEN` | Inbox webhook verification |
| `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_FB_LOGIN_CONFIG_ID` | Meta app identifiers used by the inbox onboarding UI |
| `CRON_SECRET` | Authenticates scheduled and background endpoints |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Service-account JSON used by `scripts/register-risc.ts` to register the RISC event stream |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 web client ID used to verify the Security Event Token audience |

WhatsApp and Instagram accounts are configured per workspace and stored
encrypted in the database. Only the webhook verification secrets belong in the
environment.

`WHATSAPP_ACCESS_TOKEN` is no longer read by application code, but
`scripts/setup-secrets.sh` and `.github/workflows/deploy-cloudrun.yml` still
pass it through to Cloud Run, so the secret must continue to exist for deploys
to succeed.

## Where these files live

The Next.js app reads `apps/web/.env.local`, because `next dev` runs with
`apps/web` as its working directory. The root `.env` and `.env.local` files
reach root-level scripts (`db:migrate`, `db:seed`, `scripts/*`) and the E2E
harness.
