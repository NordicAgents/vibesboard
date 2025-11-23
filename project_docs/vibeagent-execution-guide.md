# VibeAgent Execution Guide

This document provides a start-to-finish checklist for delivering the VibeAgent feature set: schema, APIs, LangGraph runtime, UI flows, and deployment readiness. Follow the sections in order; each builds on the previous work.

---

## 1. Prerequisites

1. **Environment**
   - Node.js 18+ and pnpm/npm available.
   - Supabase project with service role key and anon key.
   - OpenAI API key (`OPENAI_API_KEY`).

2. **Env Variables**
   Configure `.env.local`:
   ```bash
   OPENAI_API_KEY="sk-..."
   NEXT_PUBLIC_SUPABASE_URL="https://YOUR_PROJECT.supabase.co"
   SUPABASE_ANON_KEY="public-anon-key"
   SUPABASE_SERVICE_ROLE_KEY="service-role-key"
   ```

3. **Dependencies**
   ```bash
   npm install
   ```

---

## 2. Database & Storage

1. **Apply Migration**
   - File: `supabase/migrations/20240909000000_vibe_agents.sql`
   - Run `supabase db push` or apply via SQL editor.

2. **Storage Bucket**
   - Bucket `agent-files` is created by the migration.
   - Ensure RLS policies succeed by testing an authenticated upload.

3. **Regenerate Types**
   ```bash
   npx supabase gen types typescript --project-ref YOUR_PROJECT \
     --schema public > lib/db_types.ts
   ```

---

## 3. Backend APIs

| Area | Route | Notes |
|------|-------|-------|
| Agents CRUD | `app/api/agents` | Create/list agents for owner. |
| Agent detail | `app/api/agents/[id]` | Fetch/update/delete by owner. |
| Share data | `app/api/agents/[id]/share` | Returns share URL + QR data URL. |
| Auth chat | `app/api/agents/[id]/chat` | Streams responses, persists conversation. |
| Auth conversations | `app/api/agents/[id]/conversations` + `[cid]` | List + fetch transcripts. |
| Public chat | `app/api/public/agents/[slug]/chat` | Anonymous access with cookie. |
| Public conversations | `app/api/public/agents/[slug]/conversations` | Lists anon convos for that cookie. |

Implementation highlights:
- All agent routes use `runtime = 'nodejs'`.
- Conversations persisted via `lib/agents/conversations.ts`.
- File context pulled via `lib/agent/rag.ts`.
- LangGraph runtime + built-in tools invoked through `lib/agent/runtime.ts`.

---

## 4. Agent Runtime

1. **Graph Execution**
   - Files: `lib/agent/runtime.ts`, `lib/agent/graph.ts`.
   - Flow: system prompt → model → optional tool loop → assistant message stored.

2. **Built-in Tools**
   - `lib/agent/tools/base.ts`: shared interfaces.
   - `lib/agent/tools/builtin.ts`: web fetch, DuckDuckGo search, file search.
   - Extend by adding new factories and referencing them in `buildToolKit`.

3. **Summaries**
   - `lib/agent/summarize.ts` runs a short completion to populate conversation summaries asynchronously.

---

## 5. UI & Pages

1. **Creation Flow**
   - `/agents/new` page with `AgentBuilder`.
   - Helper chat uses `/api/agent-helper`.
   - Uploads go to `agent-files` bucket via Supabase browser client.

2. **Dashboard & Sharing**
   - `/agents/[id]` shows share URL, QR code (`components/qr-code.tsx`), file list, toggles.
   - `/agents/[id]/conversations` lists owner chats; `[cid]` opens full chat with `AgentChat`.

3. **Public Page**
   - `/a/[slug]` hosts anonymous chat plus history scoped by cookie.

4. **Sidebar Integration**
   - `components/sidebar-list.tsx` now surfaces agents + chats.

---

## 6. Testing Checklist

1. **Type Checking**
   ```bash
   npm run type-check
   ```
2. **Manual Flows**
   - Create agent with instructions + files.
   - Chat as owner; verify conversation persists + summarizes.
   - Copy share link/QR; open in another browser, confirm cookie-based history.
   - Toggle anonymous access off and ensure public route blocks.
3. **Storage**
   - Attempt uploading/removing files via dashboard to confirm policies.

---

## 7. Deployment Notes

- Ensure `OPENAI_API_KEY` and Supabase keys are present on the hosting platform (Vercel, Fly, etc.).
- Supabase service role key must only be used in server routes (never client).
- Because LangGraph requires Node runtime, skip Next.js Edge for agent API routes.

---

## 8. Future Enhancements

- Add additional built-in tools (calendar, CRM hooks, etc.).
- Re-introduce MCP or other provider frameworks when requirements firm up.
- Improve streaming for tool-enabled runs by piping LangGraph stream output.
- Implement rate limiting on public endpoints.
