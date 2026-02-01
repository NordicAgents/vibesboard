-- migrate:up

-- Add mode column: 'provider' (default) or 'collector'
ALTER TABLE public.vibe_agents
ADD COLUMN mode text NOT NULL DEFAULT 'provider'
CHECK (mode IN ('provider', 'collector'));

-- Add max_messages column: optional limit for collectors (default 5)
ALTER TABLE public.vibe_agents
ADD COLUMN max_messages integer NULL DEFAULT 5;

-- Add comment for documentation
COMMENT ON COLUMN public.vibe_agents.mode IS 'Agent mode: provider (gives information) or collector (gathers information)';
COMMENT ON COLUMN public.vibe_agents.max_messages IS 'Maximum messages before auto-completing (mainly for collector mode)';

-- migrate:down
ALTER TABLE public.vibe_agents DROP COLUMN IF EXISTS max_messages;
ALTER TABLE public.vibe_agents DROP COLUMN IF EXISTS mode;
