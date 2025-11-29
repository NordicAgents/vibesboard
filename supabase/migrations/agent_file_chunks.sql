-- Table for vectorized file chunks used by RAG
create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists public.agent_file_chunks (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.vibe_agents(id) on delete cascade,
  file_key text not null,
  file_name text not null,
  mime_type text,
  chunk_index int not null,
  content text not null,
  embedding vector(1536),
  created_at timestamptz default now()
);

create index if not exists agent_file_chunks_agent_file_idx on public.agent_file_chunks (agent_id, file_key);
create index if not exists agent_file_chunks_embedding_idx on public.agent_file_chunks using ivfflat (embedding vector_l2_ops) with (lists = 100);

alter table public.agent_file_chunks enable row level security;

-- Service role (server) bypass
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_file_chunks'
      and policyname = 'agent_file_chunks_service_role_all'
  ) then
    create policy agent_file_chunks_service_role_all
      on public.agent_file_chunks
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end;
$$;

-- Owners (authenticated users) can manage their own agent chunks
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'agent_file_chunks'
      and policyname = 'agent_file_chunks_owner_all'
  ) then
    create policy agent_file_chunks_owner_all
      on public.agent_file_chunks
      for all
      to authenticated
      using (
        exists (
          select 1
          from public.vibe_agents va
          where va.id = agent_file_chunks.agent_id
            and va.user_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.vibe_agents va
          where va.id = agent_file_chunks.agent_id
            and va.user_id = auth.uid()
        )
      );
  end if;
end;
$$;

-- RPC helper for similarity search
create or replace function public.match_agent_file_chunks(
  agent_id uuid,
  query_embedding vector(1536),
  match_count int default 8
) returns table (
  file_key text,
  file_name text,
  mime_type text,
  chunk_index int,
  content text,
  similarity double precision
) language sql stable as $$
  select
    file_key,
    file_name,
    mime_type,
    chunk_index,
    content,
    1 - (embedding <-> query_embedding) as similarity
  from public.agent_file_chunks
  where agent_id = match_agent_file_chunks.agent_id
  order by embedding <-> query_embedding
  limit match_count;
$$;
