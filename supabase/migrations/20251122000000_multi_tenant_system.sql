-- Multi-Tenant System Migration
-- This migration introduces a comprehensive multi-tenant architecture
-- with tenant management, branding, feature flags, and user roles

-- migrate:up

-- ==============================================
-- TABLES
-- ==============================================

-- Tenants table: Core multi-tenant entity
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'trial', 'suspended')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenants_slug_idx on public.tenants (slug);
create index if not exists tenants_status_idx on public.tenants (status);
create index if not exists tenants_created_by_idx on public.tenants (created_by);

-- Tenant branding configuration
create table if not exists public.tenant_branding (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id) on delete cascade,
  logo_url text,
  primary_color text not null default '#000000',
  secondary_color text not null default '#ffffff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenant_branding_tenant_id_idx on public.tenant_branding (tenant_id);

-- Feature flags: Global feature toggles
create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  default_value boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists feature_flags_name_idx on public.feature_flags (name);

-- Tenant-specific feature toggles
create table if not exists public.tenant_feature_toggles (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  feature_flag_id uuid not null references public.feature_flags(id) on delete cascade,
  is_enabled boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, feature_flag_id)
);

create index if not exists tenant_feature_toggles_tenant_id_idx on public.tenant_feature_toggles (tenant_id);

-- Tenant users: Maps users to tenants with roles
create table if not exists public.tenant_users (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role text not null check (role in ('SUPER_ADMIN', 'TENANT_ADMIN', 'MEMBER')),
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create index if not exists tenant_users_user_id_idx on public.tenant_users (user_id);
create index if not exists tenant_users_tenant_id_idx on public.tenant_users (tenant_id);
create index if not exists tenant_users_role_idx on public.tenant_users (role);

-- Invitations: Invite users to tenants
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  token text not null unique,
  role text not null check (role in ('TENANT_ADMIN', 'MEMBER')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists invitations_token_idx on public.invitations (token);
create index if not exists invitations_email_idx on public.invitations (email);
create index if not exists invitations_tenant_id_idx on public.invitations (tenant_id);
create index if not exists invitations_status_idx on public.invitations (status);

-- ==============================================
-- MODIFY EXISTING TABLES
-- ==============================================

-- Add tenant_id to vibe_agents
alter table public.vibe_agents
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade;

create index if not exists vibe_agents_tenant_id_idx on public.vibe_agents (tenant_id);

-- ==============================================
-- DATA MIGRATION
-- ==============================================

-- Create personal tenant for each existing user
do $$
declare
  user_record record;
  new_tenant_id uuid;
begin
  for user_record in select id from auth.users
  loop
    -- Create personal tenant for user
    insert into public.tenants (name, slug, status, created_by)
    values (
      'Personal',
      'user-' || user_record.id,
      'active',
      user_record.id
    )
    returning id into new_tenant_id;

    -- Create tenant_branding record
    insert into public.tenant_branding (tenant_id)
    values (new_tenant_id);

    -- Create tenant_users record with TENANT_ADMIN role
    insert into public.tenant_users (user_id, tenant_id, role)
    values (user_record.id, new_tenant_id, 'TENANT_ADMIN');

    -- Update vibe_agents to belong to personal tenant
    update public.vibe_agents
    set tenant_id = new_tenant_id
    where user_id = user_record.id;
  end loop;
end $$;

-- Insert default feature flags
insert into public.feature_flags (name, description, default_value) values
  ('BETA_ANALYTICS', 'Access to beta analytics dashboard', false),
  ('ADVANCED_TOOLS', 'Advanced agent tools and integrations', false),
  ('CUSTOM_BRANDING', 'Custom branding and white-labeling', true),
  ('API_ACCESS', 'API access for programmatic control', false),
  ('TEAM_COLLABORATION', 'Team features and shared workspaces', true)
on conflict (name) do nothing;

-- ==============================================
-- ROW LEVEL SECURITY POLICIES
-- ==============================================

-- Enable RLS on all new tables
alter table public.tenants enable row level security;
alter table public.tenant_branding enable row level security;
alter table public.feature_flags enable row level security;
alter table public.tenant_feature_toggles enable row level security;
alter table public.tenant_users enable row level security;
alter table public.invitations enable row level security;

-- Drop old agent policies
drop policy if exists agents_owner_all on public.vibe_agents;
drop policy if exists agents_public_read on public.vibe_agents;

-- TENANTS policies
create policy tenants_super_admin_all
  on public.tenants
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and role = 'SUPER_ADMIN'
    )
  );

create policy tenants_members_read
  on public.tenants
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and tenant_id = tenants.id
    )
  );

-- TENANT_BRANDING policies
create policy tenant_branding_super_admin_all
  on public.tenant_branding
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and role = 'SUPER_ADMIN'
    )
  );

create policy tenant_branding_tenant_admin_all
  on public.tenant_branding
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() 
        and tenant_id = tenant_branding.tenant_id
        and role in ('TENANT_ADMIN', 'SUPER_ADMIN')
    )
  );

create policy tenant_branding_members_read
  on public.tenant_branding
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and tenant_id = tenant_branding.tenant_id
    )
  );

-- FEATURE_FLAGS policies
create policy feature_flags_super_admin_all
  on public.feature_flags
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and role = 'SUPER_ADMIN'
    )
  );

create policy feature_flags_all_authenticated_read
  on public.feature_flags
  for select
  to authenticated
  using (true);

-- TENANT_FEATURE_TOGGLES policies
create policy tenant_feature_toggles_super_admin_all
  on public.tenant_feature_toggles
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and role = 'SUPER_ADMIN'
    )
  );

create policy tenant_feature_toggles_tenant_admin_all
  on public.tenant_feature_toggles
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() 
        and tenant_id = tenant_feature_toggles.tenant_id
        and role in ('TENANT_ADMIN', 'SUPER_ADMIN')
    )
  );

create policy tenant_feature_toggles_members_read
  on public.tenant_feature_toggles
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and tenant_id = tenant_feature_toggles.tenant_id
    )
  );

-- TENANT_USERS policies
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

-- INVITATIONS policies
create policy invitations_tenant_admin_create
  on public.invitations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() 
        and tenant_id = invitations.tenant_id
        and role in ('TENANT_ADMIN', 'SUPER_ADMIN')
    )
  );

create policy invitations_tenant_admin_read
  on public.invitations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() 
        and tenant_id = invitations.tenant_id
        and role in ('TENANT_ADMIN', 'SUPER_ADMIN')
    )
  );

create policy invitations_tenant_admin_update
  on public.invitations
  for update
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() 
        and tenant_id = invitations.tenant_id
        and role in ('TENANT_ADMIN', 'SUPER_ADMIN')
    )
  );

-- PUBLIC access to invitation by token (for acceptance flow)
create policy invitations_public_read_by_token
  on public.invitations
  for select
  to authenticated
  using (token is not null);

-- VIBE_AGENTS policies (updated for multi-tenant)
create policy agents_public_read
  on public.vibe_agents
  for select
  to public
  using (allow_anonymous = true);

create policy agents_tenant_members_all
  on public.vibe_agents
  for all
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and tenant_id = vibe_agents.tenant_id
    )
  )
  with check (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and tenant_id = vibe_agents.tenant_id
    )
  );

-- ==============================================
-- FUNCTIONS
-- ==============================================

-- Function to get user's role in a tenant
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

-- Function to check if user is super admin
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

-- Function to check if feature is enabled for tenant
create or replace function public.is_feature_enabled(p_tenant_id uuid, p_feature_name text)
returns boolean
language plpgsql
security definer
as $$
declare
  is_enabled boolean;
  default_val boolean;
  flag_id uuid;
begin
  -- Get feature flag default value and id
  select id, default_value into flag_id, default_val
  from public.feature_flags
  where name = p_feature_name;
  
  if flag_id is null then
    return false;
  end if;
  
  -- Check if tenant has override
  select tft.is_enabled into is_enabled
  from public.tenant_feature_toggles tft
  where tft.tenant_id = p_tenant_id and tft.feature_flag_id = flag_id;
  
  -- Return override if exists, otherwise return default
  return coalesce(is_enabled, default_val);
end;
$$;

-- Trigger to update updated_at timestamp
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply updated_at triggers
create trigger update_tenants_updated_at before update on public.tenants
  for each row execute function public.update_updated_at_column();

create trigger update_tenant_branding_updated_at before update on public.tenant_branding
  for each row execute function public.update_updated_at_column();

create trigger update_tenant_feature_toggles_updated_at before update on public.tenant_feature_toggles
  for each row execute function public.update_updated_at_column();

-- migrate:down

-- Drop triggers
drop trigger if exists update_tenants_updated_at on public.tenants;
drop trigger if exists update_tenant_branding_updated_at on public.tenant_branding;
drop trigger if exists update_tenant_feature_toggles_updated_at on public.tenant_feature_toggles;

-- Drop functions
drop function if exists public.update_updated_at_column();
drop function if exists public.is_feature_enabled(uuid, text);
drop function if exists public.is_super_admin(uuid);
drop function if exists public.get_user_tenant_role(uuid, uuid);

-- Drop vibe_agents policies
drop policy if exists agents_tenant_members_all on public.vibe_agents;
drop policy if exists agents_public_read on public.vibe_agents;

-- Drop invitations policies
drop policy if exists invitations_public_read_by_token on public.invitations;
drop policy if exists invitations_tenant_admin_update on public.invitations;
drop policy if exists invitations_tenant_admin_read on public.invitations;
drop policy if exists invitations_tenant_admin_create on public.invitations;

-- Drop tenant_users policies
drop policy if exists tenant_users_members_read_own_tenant on public.tenant_users;
drop policy if exists tenant_users_tenant_admin_manage on public.tenant_users;
drop policy if exists tenant_users_super_admin_all on public.tenant_users;

-- Drop tenant_feature_toggles policies
drop policy if exists tenant_feature_toggles_members_read on public.tenant_feature_toggles;
drop policy if exists tenant_feature_toggles_tenant_admin_all on public.tenant_feature_toggles;
drop policy if exists tenant_feature_toggles_super_admin_all on public.tenant_feature_toggles;

-- Drop feature_flags policies
drop policy if exists feature_flags_all_authenticated_read on public.feature_flags;
drop policy if exists feature_flags_super_admin_all on public.feature_flags;

-- Drop tenant_branding policies
drop policy if exists tenant_branding_members_read on public.tenant_branding;
drop policy if exists tenant_branding_tenant_admin_all on public.tenant_branding;
drop policy if exists tenant_branding_super_admin_all on public.tenant_branding;

-- Drop tenants policies
drop policy if exists tenants_members_read on public.tenants;
drop policy if exists tenants_super_admin_all on public.tenants;

-- Disable RLS
alter table public.invitations disable row level security;
alter table public.tenant_users disable row level security;
alter table public.tenant_feature_toggles disable row level security;
alter table public.feature_flags disable row level security;
alter table public.tenant_branding disable row level security;
alter table public.tenants disable row level security;

-- Remove tenant_id from vibe_agents
alter table public.vibe_agents drop column if exists tenant_id;

-- Drop tables
drop table if exists public.invitations;
drop table if exists public.tenant_users;
drop table if exists public.tenant_feature_toggles;
drop table if exists public.feature_flags;
drop table if exists public.tenant_branding;
drop table if exists public.tenants;

-- Restore old vibe_agents policies
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
