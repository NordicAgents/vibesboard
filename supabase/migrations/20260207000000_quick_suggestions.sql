-- migrate:up

-- Per-agent quick suggestions configuration
alter table public.vibe_agents
  add column if not exists quick_suggestions_mode text not null default 'off';

alter table public.vibe_agents
  add column if not exists quick_suggestions_count int not null default 4;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vibe_agents_quick_suggestions_mode_check'
  ) then
    alter table public.vibe_agents
      add constraint vibe_agents_quick_suggestions_mode_check
      check (quick_suggestions_mode in ('off', 'smart', 'always'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'vibe_agents_quick_suggestions_count_check'
  ) then
    alter table public.vibe_agents
      add constraint vibe_agents_quick_suggestions_count_check
      check (quick_suggestions_count in (3, 4));
  end if;
end $$;

-- migrate:down

alter table public.vibe_agents
  drop constraint if exists vibe_agents_quick_suggestions_mode_check;

alter table public.vibe_agents
  drop constraint if exists vibe_agents_quick_suggestions_count_check;

alter table public.vibe_agents
  drop column if exists quick_suggestions_count;

alter table public.vibe_agents
  drop column if exists quick_suggestions_mode;
