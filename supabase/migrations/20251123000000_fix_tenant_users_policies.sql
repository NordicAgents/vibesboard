-- Fix tenant_users RLS recursion and wire helper functions

-- migrate:up

-- Redefine helper functions so they can safely query tenant_users
-- without triggering RLS recursion (row_security is disabled inside).

create or replace function public.get_user_tenant_role(p_user_id uuid, p_tenant_id uuid)
returns text
language sql
security definer
set search_path = public
set row_security = off
as $$
  select role::text
  from public.tenant_users
  where user_id = p_user_id
    and tenant_id = p_tenant_id
  limit 1;
$$;

create or replace function public.is_super_admin(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.tenant_users
    where user_id = p_user_id
      and role = 'SUPER_ADMIN'
  );
$$;

-- Recreate tenant_users policies without self-referential queries.

drop policy if exists tenant_users_members_read_own_tenant on public.tenant_users;
drop policy if exists tenant_users_tenant_admin_manage on public.tenant_users;
drop policy if exists tenant_users_super_admin_all on public.tenant_users;

-- SUPER_ADMIN: full access to all tenant_users rows
create policy tenant_users_super_admin_all
  on public.tenant_users
  for all
  to authenticated
  using (public.is_super_admin(auth.uid()));

-- TENANT_ADMIN or SUPER_ADMIN: manage members within their tenant
create policy tenant_users_tenant_admin_manage
  on public.tenant_users
  for all
  to authenticated
  using (
    public.get_user_tenant_role(auth.uid(), tenant_users.tenant_id) in ('TENANT_ADMIN', 'SUPER_ADMIN')
  );

-- Any member of a tenant can read the membership list for that tenant
create policy tenant_users_members_read_own_tenant
  on public.tenant_users
  for select
  to authenticated
  using (
    public.get_user_tenant_role(auth.uid(), tenant_users.tenant_id) is not null
  );

-- migrate:down

-- Restore original helper function definitions (without row_security override)

create or replace function public.get_user_tenant_role(p_user_id uuid, p_tenant_id uuid)
returns text
language plpgsql
security definer
as $$
declare
  user_role text;
begin
  select role into user_role
  from public.tenant_users
  where user_id = p_user_id and tenant_id = p_tenant_id;
  
  return user_role;
end;
$$;

create or replace function public.is_super_admin(p_user_id uuid)
returns boolean
language plpgsql
security definer
as $$
begin
  return exists (
    select 1 from public.tenant_users
    where user_id = p_user_id and role = 'SUPER_ADMIN'
  );
end;
$$;

-- Restore original self-referential policies (note: reintroduces recursion).

drop policy if exists tenant_users_members_read_own_tenant on public.tenant_users;
drop policy if exists tenant_users_tenant_admin_manage on public.tenant_users;
drop policy if exists tenant_users_super_admin_all on public.tenant_users;

create policy tenant_users_super_admin_all
  on public.tenant_users
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users tu
      where tu.user_id = auth.uid() and tu.role = 'SUPER_ADMIN'
    )
  );

create policy tenant_users_tenant_admin_manage
  on public.tenant_users
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users tu
      where tu.user_id = auth.uid() 
        and tu.tenant_id = tenant_users.tenant_id
        and tu.role in ('TENANT_ADMIN', 'SUPER_ADMIN')
    )
  );

create policy tenant_users_members_read_own_tenant
  on public.tenant_users
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users tu
      where tu.user_id = auth.uid() and tu.tenant_id = tenant_users.tenant_id
    )
  );

