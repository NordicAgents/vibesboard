-- migrate:up
create extension if not exists vector;

create table if not exists public.vibe_agent_conversation_chunks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.vibe_agents(id) on delete cascade,
  conversation_id uuid not null references public.vibe_agent_conversations(id) on delete cascade,
  message_index int not null,
  chunk_index int not null default 0,
  role text not null,
  content text not null,
  embedding vector(1536) not null,
  created_at timestamptz not null default now()
);

create index if not exists vibe_agent_conversation_chunks_agent_idx
  on public.vibe_agent_conversation_chunks (agent_id, created_at desc);

create index if not exists vibe_agent_conversation_chunks_convo_idx
  on public.vibe_agent_conversation_chunks (conversation_id, created_at desc);

alter table public.vibe_agent_conversation_chunks enable row level security;

create policy convo_chunks_owner_all
  on public.vibe_agent_conversation_chunks
  for all
  to authenticated
  using (
    exists (
      select 1 from public.vibe_agents a where a.id = agent_id and a.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.vibe_agents a where a.id = agent_id and a.user_id = auth.uid()
    )
  );

create or replace function public.match_agent_conversation_chunks(
  p_agent_id uuid,
  p_query_embedding vector(1536),
  p_match_count int,
  p_conversation_id uuid default null
)
returns table (
  conversation_id uuid,
  message_index int,
  chunk_index int,
  role text,
  content text,
  similarity float
)
language sql
stable
as $$
  select
    c.conversation_id,
    c.message_index,
    c.chunk_index,
    c.role,
    c.content,
    (1 - (c.embedding <=> p_query_embedding)) as similarity
  from public.vibe_agent_conversation_chunks c
  where c.agent_id = p_agent_id
    and (p_conversation_id is null or c.conversation_id = p_conversation_id)
  order by c.embedding <=> p_query_embedding
  limit greatest(p_match_count, 1);
$$;

-- migrate:down
drop function if exists public.match_agent_conversation_chunks(uuid, vector(1536), int, uuid);
drop policy if exists convo_chunks_owner_all on public.vibe_agent_conversation_chunks;
alter table public.vibe_agent_conversation_chunks disable row level security;
drop table if exists public.vibe_agent_conversation_chunks;
