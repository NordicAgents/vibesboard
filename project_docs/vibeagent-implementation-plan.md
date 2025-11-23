# VibeAgent – Implementation Plan

This plan outlines how to implement user‑built agents, public sharing via URL/QR, persisted conversations, and chat over existing conversations. It builds on the current Next.js + Supabase + Vercel AI SDK template and introduces a LangGraph-powered agent runtime with curated built-in tools.

## Goals & Outcomes

- Users create custom “VibeAgents” with instructions and optional uploaded files.
- Each agent has a shareable URL and QR code. Visitors can chat with the agent.
- Conversations are stored per agent (authenticated or anonymous visitors), summarized, and resume‑able.
- Users see their agents in the sidebar and manage dashboards, files, and conversations.
- Implementation cleanly integrates LangGraph with built-in tools for tool‑use and RAG over uploaded files.

---

## Architecture Overview

- UI: Next.js 13 App Router, Tailwind, existing components.
- Auth & Data: Supabase (Auth, Postgres, Storage). RLS for multi‑tenancy.
- LLM/Streaming: Vercel AI SDK (`ai`) with OpenAI (or compatible) models.
- Agent Runtime: LangGraph (Node runtime) with built-in tool bridge.
- Files: Supabase Storage (`agent-files` bucket). File keys stored per agent.
- Share: Public route `/a/:slug` (agentURL). QR encodes this URL.
- Persistence: Conversations saved in `vibe_agent_conversations` as JSON messages; summarized on completion.

Notes:
- LangGraph requires the Node runtime (not Edge). Use `export const runtime = 'nodejs'` for agent chat routes.
- Public chats (via QR) write through a server route using a Supabase service key to simplify anon persistence while keeping RLS strict.

---

## Data Model & Migrations

Tables use snake_case in DB. App types map to camelCase.

1) `public.vibe_agents`

- `id` uuid primary key default `gen_random_uuid()`
- `user_id` uuid references `auth.users(id)` on delete cascade
- `name` text not null
- `instructions` text not null
- `file_keys` jsonb not null default '[]'  -- array of storage paths
- `agent_url` text unique not null        -- public slug
- `tools` jsonb not null default '[]'     -- allowed tool names/config
- `allow_anonymous` boolean not null default true
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Indexes: unique on `agent_url`, btree on `(user_id, created_at)`

RLS:
- Enable RLS.
- `select` to public when `agent_url is not null`.
- `all` to authenticated owner (`auth.uid() = user_id`).

2) `public.vibe_agent_conversations`

- `id` uuid primary key default `gen_random_uuid()`
- `agent_id` uuid references `public.vibe_agents(id)` on delete cascade
- `user_id` uuid null references `auth.users(id)` on delete set null
- `external_id` text null                  -- for anonymous sessions (cookie correlate)
- `messages` jsonb not null default '[]'   -- array of {role, content, ...}
- `summary` text null
- `created_at` timestamptz not null default now()
- `updated_at` timestamptz not null default now()

Indexes: btree on `(agent_id, created_at)`, `(user_id, created_at)`, `(external_id, created_at)`

RLS:
- Enable RLS.
- Authenticated: full access to rows where `auth.uid() = user_id`.
- Public: `select/insert/update` denied by default. Anonymous flow goes through server route with service role to uphold application‑level scoping using `external_id` cookie.

3) Storage

- Create `agent-files` bucket.
- Restrict public access; signed URLs for downloads at runtime.

4) Migration SQL (sketch)

```
create table public.vibe_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  instructions text not null,
  file_keys jsonb not null default '[]'::jsonb,
  agent_url text unique not null,
  tools jsonb not null default '[]'::jsonb,
  allow_anonymous boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.vibe_agents enable row level security;

create policy "agents_public_read"
  on public.vibe_agents for select to public
  using (agent_url is not null);

create policy "agents_owner_all"
  on public.vibe_agents for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table public.vibe_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.vibe_agents(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  external_id text null,
  messages jsonb not null default '[]'::jsonb,
  summary text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on public.vibe_agent_conversations(agent_id, created_at);
create index on public.vibe_agent_conversations(user_id, created_at);
create index on public.vibe_agent_conversations(external_id, created_at);

alter table public.vibe_agent_conversations enable row level security;

create policy "convos_owner_all"
  on public.vibe_agent_conversations for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

Update generated types in `lib/db_types.ts` after migration.

---

## Agent Runtime (LangGraph + Tools)

Goal: Compose an agent pipeline that can:
- Use instructions + uploaded files (RAG) to ground responses.
- Call approved built-in tools (web fetch, file loaders, custom APIs via server routes).
- Stream tokens to the client while persisting messages.

Components:
- `lib/agent/graph.ts`: Constructs LangGraph with nodes: Input → Router → Tools → LLM → Output.
- `lib/agent/memory.ts`: Conversation state adapter (reads/writes to `vibe_agent_conversations`).
- `lib/agent/tools/builtin.ts`: Built-in tool runners (web fetch, search, file lookup).
- `lib/agent/rag.ts`: Loader + chunking + embedding + retrieval for `file_keys` (Supabase Storage + optional pgvector).

Graph sketch:
```
state = { messages, agent, tools, context }

Input ->
  Add system prompt from agent.instructions
  Inject retrieved context (RAG) if available
  Route: if tool call present -> Tools else -> LLM

Tools ->
  Call tool runner with limited set from agent.tools
  Append tool results to messages
  Back to LLM

LLM ->
  Stream tokens; on completion persist assistant message
  Update summary asynchronously

Output -> stream via Vercel AI SDK
```

Runtime notes:
- Use Node runtime. Avoid Edge for tool process spawning and storage I/O.
- Enforce tool whitelist per agent (`tools` column).
- Add execution budget, token limits, and size caps.

---

## API & Routes

All new agent routes are Node runtime unless read‑only.

1) Create/Manage Agents
- `POST /api/agents` (auth): create agent (name, instructions, files, tools). Generates unique `agent_url` slug.
- `GET /api/agents` (auth): list user’s agents.
- `GET /api/agents/:id` (auth): fetch agent by id.
- `PATCH /api/agents/:id` (auth): update agent.
- `DELETE /api/agents/:id` (auth): delete agent.

2) Share & QR
- `GET /api/agents/:id/share` (auth): returns `{ url, qrPng }` for QR (PNG or data URL). The URL is `/a/:slug`.
- Public route: `GET /a/:slug` – loads agent (read‑only) and renders chat UI.

3) Chat (streaming)
- Authenticated: `POST /api/agents/:id/chat` – streams reply and persists to `vibe_agent_conversations(user_id)`.
- Public: `POST /api/public/agents/:slug/chat` – streams reply and persists to `vibe_agent_conversations(external_id)` using service role on server. Sets/reads an http‑only cookie `va_ext` (UUID) for session correlation.

4) Conversations
- `GET /api/agents/:id/conversations` (auth): list with `summary`, `last_message_at`.
- `GET /api/agents/:id/conversations/:cid` (auth): full transcript.
- `PATCH /api/agents/:id/conversations/:cid` (auth): rename summary or soft delete.
- Public equivalents under `/api/public/...` scoped by `va_ext` cookie and `agent.allow_anonymous`.

---

## UI/UX Flows

Map to requirements (1.x–5.x).

1) Build Agent
- 1.1 “Develop via chat”: A guided creator page where user converses with a helper agent to refine `instructions` and select tools/files. Persist draft state in local state; only save on finalize.
- 1.2 Show agent card before creating: Preview card with name, truncated instructions, tool badges, file count.
- 1.3 Once created, show on left sidebar: Sidebar lists Agents (separate section from Chats). Clicking an agent opens its dashboard.

2) Agent Dashboard
- 2.1 Simple dashboard: shows share URL, QR, file list, tool list, quick actions (Start chat, View conversations, Edit agent).
- 2.2 Share via QR: Render QR to PNG; Copy link button. Toggle “Allow anonymous chat”.

3) Public Chat by QR/URL
- 3.1 Scan QR → `/a/:slug`: Renders a lean chat UI with agent name and avatar; no sign‑in required. Cookie `va_ext` created if absent. Messages stream from server; conversation persisted under `external_id`.

4) View Conversations
- 4.1 Auth users see existing conversations per agent (list with `summary`, last updated). Public visitors see their own anonymous conversations for that agent (scoped by cookie).

5) Continue Chat
- 5.1 Clicking a conversation opens full transcript and resumes chat with same agent and context.

Key Components (new):
- `components/agents/agent-card-preview.tsx`
- `components/agents/agent-dashboard.tsx`
- `components/agents/agent-list.tsx` (sidebar integration)
- `components/qr-code.tsx` (wrap `qrcode` lib)
- `components/agent-chat.tsx` (like `components/chat.tsx` but agent‑aware)

Routing (new pages):
- `/agents/new` – guided creator (develop via chat)
- `/agents/[id]` – dashboard
- `/agents/[id]/conversations` – list
- `/agents/[id]/conversations/[cid]` – chat view
- `/a/[slug]` – public chat

---

## Storage & Files

- Bucket: `agent-files`
- Upload UI in agent creator and dashboard (drag/drop)
- Store storage keys in `vibe_agents.file_keys` (JSON array)
- At runtime, signed URLs fetched by server for RAG loader
- Optional: background embedding to Supabase `match_documents` (pgvector) for scalable retrieval

---

## Streaming & Persistence

- Use Vercel AI SDK to stream tokens from LLM.
- On completion, append assistant message to conversation and upsert in `vibe_agent_conversations`.
- For public chat, perform writes in server route using service role; bind access to `external_id` cookie value.
- Summarization: trigger a short prompt on first few/last messages to populate `summary` (or update when length increases). Done asynchronously in the route handler after `onCompletion`.

---

## Security & Policies

- RLS strictly isolates authenticated data by `user_id`.
- Public agent read is allowed when `agent_url` exists; no sensitive data in agent rows.
- Public conversation writes happen server‑side only; no direct client Supabase writes for anon users.
- Rate limit public chat endpoints by IP and cookie; cap message size and count.
- Sign storage downloads; never expose raw storage keys client‑side.

---

## Integration With Existing Code

- Keep current chat features intact (`app/api/chat/route.ts`, `components/chat.tsx`).
- Add agent‑aware chat parallel to existing chat to avoid regressions:
  - New server routes under `app/api/agents/...` (Node runtime)
  - New pages under `/agents/...` and `/a/[slug]`
- Sidebar: introduce an Agents section alongside existing Chats (extend `components/sidebar-list.tsx`).
- Supabase types: regenerate `lib/db_types.ts` after migrations to include new tables.

---

## Environment & Dependencies

Add:
- `@langchain/langgraph` + `@langchain/core` (agent runtime)
- `qrcode` or `qrcode.react` (QR rendering)
- `pgvector` extension in Supabase + embedding model

Env vars:
- `OPENAI_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server only; for public chat writes)
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_ANON_KEY`

---

## Milestones & Tasks

M1 – Data & Scaffolding (0.5–1 day)
- Write migrations for `vibe_agents` and `vibe_agent_conversations`
- Create `agent-files` bucket
- Regenerate `lib/db_types.ts`

M2 – Agent Creation & Sidebar (1–2 days)
- Build `/agents/new` with chat‑guided creator + preview card
- Implement `POST /api/agents` and list in sidebar

M3 – Dashboard & Share (0.5–1 day)
- Build `/agents/[id]` dashboard with QR, share URL, toggles
- Implement `GET /api/agents/:id/share`

M4 – Agent Chat (Auth) (1–2 days)
- Implement `POST /api/agents/:id/chat` (stream, persist)
- Build `/agents/[id]/conversations` and `/agents/[id]/conversations/[cid]`

M5 – Public Chat (QR) (1–2 days)
- Build `/a/[slug]` page and `POST /api/public/agents/:slug/chat`
- Cookie/session handling (`va_ext`)

M6 – LangGraph Tooling (2–3 days)
- Implement graph runner, memory adapter, tool whitelist
- Add core tools: web fetch, file loader, simple search
- Wire RAG over `file_keys`

M7 – Summaries & Polish (0.5–1 day)
- Async summarization
- Empty states, toasts, error handling, rate limits

---

## Testing & Acceptance

- Unit: graph assembly, tool whitelist, URL slug generation
- Integration: agent creation, share URL, QR rendering, chat persistence
- E2E: create agent → share → public chat → owner sees conversation list
- Security: RLS enforcement for cross‑user isolation; public chat only via server route

Acceptance Criteria
- Creating an agent shows it in sidebar; dashboard displays share URL and QR
- Visiting `/a/:slug` enables chat without sign‑in; messages stream and persist
- Owners can view all conversations for their agents and continue chatting
- Conversations include machine‑generated summaries

---

## Pseudocode Snippets

Agent chat route (auth):
```ts
// app/api/agents/[id]/chat/route.ts
export const runtime = 'nodejs'
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { messages, conversationId } = await req.json()
  const user = await requireUser()
  const agent = await db.agents.get(params.id, user.id)
  const conv = await upsertConversation({ agentId: agent.id, userId: user.id, id: conversationId })
  const stream = runLangGraph({ agent, conv, messages }) // streams tokens
  return new StreamingTextResponse(stream)
}
```

Public chat route:
```ts
// app/api/public/agents/[slug]/chat/route.ts
export const runtime = 'nodejs'
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const { messages, conversationId } = await req.json()
  const ext = getOrSetCookie('va_ext')
  const agent = await db.agents.getBySlug(params.slug)
  assert(agent.allow_anonymous)
  const conv = await svc.upsertConversation({ agentId: agent.id, externalId: ext, id: conversationId })
  const stream = runLangGraph({ agent, conv, messages })
  return new StreamingTextResponse(stream)
}
```

---

## Future Enhancements

- Agent versioning and changelogs
- Collaboration (team ownership)
- Advanced RAG with pgvector and reranking
- Tool marketplace and per‑agent tool billing/quotas
- Analytics on engagement and conversation quality
