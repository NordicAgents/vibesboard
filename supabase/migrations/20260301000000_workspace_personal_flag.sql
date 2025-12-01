-- Add personal vs org workspace support and helper function

-- migrate:up

-- Add is_personal flag to tenants
alter table public.tenants
  add column if not exists is_personal boolean not null default false;

-- Index to query by workspace type
create index if not exists tenants_is_personal_idx on public.tenants (is_personal);

-- Backfill existing personal tenants created by prior migration (slug user-*)
update public.tenants
set is_personal = true
where slug like 'user-%';

-- Helper to create or fetch a user's personal tenant
create or replace function public.create_or_get_personal_tenant(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  personal_id uuid;
begin
  -- Look for existing personal tenant owned by user
  select t.id into personal_id
  from public.tenants t
  where t.created_by = p_user_id
    and t.is_personal = true
  limit 1;

  -- Create if missing
  if personal_id is null then
    insert into public.tenants (name, slug, status, created_by, is_personal)
    values (
      'Personal',
      'user-' || p_user_id,
      'active',
      p_user_id,
      true
    )
    returning id into personal_id;
  end if;

  -- Ensure branding exists
  insert into public.tenant_branding (tenant_id)
  values (personal_id)
  on conflict (tenant_id) do nothing;

  -- Ensure membership as TENANT_ADMIN
  insert into public.tenant_users (user_id, tenant_id, role)
  values (p_user_id, personal_id, 'TENANT_ADMIN')
  on conflict (user_id, tenant_id) do update set role = excluded.role;

  return personal_id;
end;
$$;

-- migrate:down

drop function if exists public.create_or_get_personal_tenant(uuid);

drop index if exists tenants_is_personal_idx;

alter table public.tenants
  drop column if exists is_personal;
