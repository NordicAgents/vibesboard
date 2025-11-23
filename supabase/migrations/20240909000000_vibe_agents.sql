-- migrate:up
create table if not exists public.vibe_agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  instructions text not null,
  file_keys jsonb not null default '[]'::jsonb,
  agent_url text not null unique,
  tools jsonb not null default '[]'::jsonb,
  allow_anonymous boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vibe_agents_user_created_idx
  on public.vibe_agents (user_id, created_at desc);

alter table public.vibe_agents enable row level security;

create policy agents_public_read
  on public.vibe_agents
  for select
  to public
  using (agent_url is not null);

create policy agents_owner_all
  on public.vibe_agents
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.vibe_agent_conversations (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.vibe_agents(id) on delete cascade,
  user_id uuid null references auth.users(id) on delete set null,
  external_id text null,
  messages jsonb not null default '[]'::jsonb,
  summary text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vibe_agent_conversations_agent_created_idx
  on public.vibe_agent_conversations (agent_id, created_at desc);

create index if not exists vibe_agent_conversations_user_created_idx
  on public.vibe_agent_conversations (user_id, created_at desc);

create index if not exists vibe_agent_conversations_external_created_idx
  on public.vibe_agent_conversations (external_id, created_at desc);

alter table public.vibe_agent_conversations enable row level security;

create policy convos_owner_all
  on public.vibe_agent_conversations
  for all
  to authenticated
  using (auth.uid() is not null and auth.uid() = user_id)
  with check (auth.uid() is not null and auth.uid() = user_id);

create policy convos_agent_owner_read
  on public.vibe_agent_conversations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.vibe_agents a
      where a.id = agent_id and a.user_id = auth.uid()
    )
  );

insert into storage.buckets (id, name, public)
values ('agent-files', 'agent-files', false)
on conflict (id) do nothing;

create policy "agent_files_read_own"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'agent-files' and (owner = auth.uid()));

create policy "agent_files_insert_own"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'agent-files' and (owner = auth.uid()));

create policy "agent_files_update_own"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'agent-files' and (owner = auth.uid()))
  with check (bucket_id = 'agent-files' and (owner = auth.uid()));

create policy "agent_files_delete_own"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'agent-files' and (owner = auth.uid()));

-- migrate:down
drop policy if exists "agent_files_delete_own" on storage.objects;
drop policy if exists "agent_files_update_own" on storage.objects;
drop policy if exists "agent_files_insert_own" on storage.objects;
drop policy if exists "agent_files_read_own" on storage.objects;
delete from storage.buckets where id = 'agent-files';

drop policy if exists convos_owner_all on public.vibe_agent_conversations;
drop policy if exists convos_agent_owner_read on public.vibe_agent_conversations;
alter table public.vibe_agent_conversations disable row level security;
drop table if exists public.vibe_agent_conversations;

drop policy if exists agents_owner_all on public.vibe_agents;
drop policy if exists agents_public_read on public.vibe_agents;
alter table public.vibe_agents disable row level security;
drop table if exists public.vibe_agents;
