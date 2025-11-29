-- migrate:up
alter table public.vibe_agent_conversations
  add column if not exists closed_at timestamptz null,
  add column if not exists summary_generated_at timestamptz null;

alter table public.vibe_agents
  add column if not exists last_embeddings_sync_at timestamptz null;

-- migrate:down
alter table public.vibe_agents
  drop column if exists last_embeddings_sync_at;

alter table public.vibe_agent_conversations
  drop column if exists summary_generated_at,
  drop column if exists closed_at;
