<h1 align="center">Vibesboard</h1>

<p align="center">
  A multi-tenant AI agent platform. Allows businesses to create, configure, and deploy AI agents with features including multi-tenant workspace isolation, RAG, Calendar availability, and WhatsApp integration.
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
- React Server Components (RSCs), Suspense, and Server Actions
- [Vercel AI SDK](https://sdk.vercel.ai/docs) for streaming chat UI
- Support for OpenAI, Anthropic, or custom AI chat models
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - [Radix UI](https://radix-ui.com) for headless component primitives
  - Icons from [Phosphor Icons](https://phosphoricons.com)
- Database with [PostgreSQL](https://postgresql.org) and [Drizzle ORM](https://orm.drizzle.team)
- Authentication via [Better-Auth](https://better-auth.com)

## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run Vibesboard locally.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various API provider accounts.

Copy the `.env.example` file and populate the required env vars:

```bash
cp .env.example .env
```

Initialize git submodules (required for the AI dev tooling):

```bash
git submodule update --init
```

Install the local dependencies and start dev mode:

```bash
bun install
bun run dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000/).

## Self-host quickstart (Postgres data plane)

Vibesboard runs on a fully self-hostable stack based on Postgres, MinIO (S3-compatible storage), and Better-Auth.

Requirements: Docker, bun.

```bash
cp .env.example .env       # already done if you run the full app locally
bun install
bun run db:setup           # docker compose up Postgres + MinIO + migrate + seed
bun run db:studio          # browse the schema at https://local.drizzle.studio
bun run minio:console      # browse the S3 bucket at http://localhost:9001
```

Run the package tests:

```bash
bun run --filter @vibesboard/adapter-postgres test
```

See [docs/superpowers/specs/2026-05-17-adapter-postgres-foundation-design.md](docs/superpowers/specs/2026-05-17-adapter-postgres-foundation-design.md) for the design.

### Sign-in methods

By default, the self-host stack supports three sign-in flows:

- **Google OAuth** — set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`.
  Without these, the Google button on the sign-in page does nothing.
- **Email + password** — works without any extra config. Email verification
  is required. Resend handles delivery (`RESEND_API_KEY`); without a key,
  verification URLs are logged to the server console (good enough for dev).
- **Magic link** — same Resend wiring; same console fallback.
