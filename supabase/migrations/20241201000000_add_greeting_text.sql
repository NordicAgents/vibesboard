-- migrate:up
alter table public.vibe_agents
  add column if not exists greeting_text text null default 'Hi How can i help you today';

-- migrate:down
alter table public.vibe_agents
  drop column if exists greeting_text;

