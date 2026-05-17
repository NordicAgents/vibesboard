<a href="https://chat.vercel.ai/">
  <img alt="Next.js 13 and app template Router-ready AI chatbot." src="https://chat.vercel.ai/opengraph-image.png" />
  <h1 align="center">Next.js AI Chatbot</h1>
</a>

<p align="center">
  An open-source AI chatbot app template built with Next.js, the Vercel AI SDK, OpenAI, and Firebase (Auth + Firestore).
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#model-providers"><strong>Model Providers</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a> ·
  <a href="#authors"><strong>Authors</strong></a>
</p>
<br/>

## Features

- [Next.js](https://nextjs.org) App Router
- React Server Components (RSCs), Suspense, and Server Actions
- [Vercel AI SDK](https://sdk.vercel.ai/docs) for streaming chat UI
- Support for OpenAI (default), Anthropic, Hugging Face, or custom AI chat models and/or LangChain
- Edge runtime-ready
- [shadcn/ui](https://ui.shadcn.com)
  - Styling with [Tailwind CSS](https://tailwindcss.com)
  - [Radix UI](https://radix-ui.com) for headless component primitives
  - Icons from [Phosphor Icons](https://phosphoricons.com)
- Chat history persisted in [Firestore](https://firebase.google.com/docs/firestore)
- [Firebase Auth](https://firebase.google.com/docs/auth) for authentication

## Model Providers

This template ships with OpenAI `gpt-5-nano` as the default (override with `OPENAI_MODEL`). However, thanks to the [Vercel AI SDK](https://sdk.vercel.ai/docs), you can switch LLM providers to [Anthropic](https://anthropic.com), [Hugging Face](https://huggingface.co), or using [LangChain](https://js.langchain.com) with just a few lines of code.

## Running locally

You will need to use the environment variables [defined in `.env.example`](.env.example) to run Next.js AI Chatbot. It's recommended you use [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables) for this, but a `.env` file is all that is necessary.

> Note: You should not commit your `.env` file or it will expose secrets that will allow others to control access to your various OpenAI and authentication provider accounts.

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
pnpm install
pnpm dev
```

Your app template should now be running on [localhost:3000](http://localhost:3000/).

## Authors

This library is created by [Vercel](https://vercel.com) and [Next.js](https://nextjs.org) team members, with contributions from:

- Jared Palmer ([@jaredpalmer](https://twitter.com/jaredpalmer)) - [Vercel](https://vercel.com)
- Shu Ding ([@shuding\_](https://twitter.com/shuding_)) - [Vercel](https://vercel.com)
- shadcn ([@shadcn](https://twitter.com/shadcn)) - [Contractor](https://shadcn.com)

## Self-host quickstart (Postgres data plane)

Vibesboard is migrating to a fully self-hostable stack. Sub-project #1 (this PR)
ships the Postgres adapter — schema, migrations, RLS, and dev tooling. It does
not yet replace Firebase in the running app; that's sub-projects #2–#6.

Requirements: Docker, pnpm.

```bash
cp .env.example .env       # already done if you run the full app locally
pnpm install
pnpm db:setup              # docker compose up + migrate + seed
pnpm db:studio             # browse the schema at https://local.drizzle.studio
```

Run the package tests:

```bash
pnpm --filter @vibesboard/adapter-postgres test
```

See [docs/superpowers/specs/2026-05-17-adapter-postgres-foundation-design.md](docs/superpowers/specs/2026-05-17-adapter-postgres-foundation-design.md) for the design.
