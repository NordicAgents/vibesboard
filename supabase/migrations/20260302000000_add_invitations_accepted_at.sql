-- Add accepted_at to invitations table

-- migrate:up

alter table public.invitations
  add column if not exists accepted_at timestamptz;

-- migrate:down

alter table public.invitations
  drop column if exists accepted_at;
