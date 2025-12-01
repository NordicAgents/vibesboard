# Workspace Plan: Personal vs Org Tenants

This document outlines the plan to support two workspace types in VibeAgent's multi-tenant system:

- **Personal workspace** – one per user, created automatically, for solo use.
- **Org workspace** – created and managed by SUPER_ADMINs for teams/organizations.

The goal is:

1. Every new user can immediately create agents in a personal workspace.
2. Personal workspaces expose read-only tenant settings (no team/branding changes).
3. Org workspaces are created by SUPER_ADMINs and support full branding, team, and invitations.

---

## 1. Data Model Changes

**Objective:** Distinguish personal vs org tenants and support auto-creation of personal tenants.

### 1.1 Add `is_personal` Flag

- Add a column to `public.tenants`:
  - `is_personal boolean not null default false`
- (Optional) Add index:
  - `create index tenants_is_personal_idx on public.tenants (is_personal);`

### 1.2 Mark Existing Personal Tenants

Leverage the existing migration logic in `20251122000000_multi_tenant_system.sql` that created personal tenants with slug `user-{uuid}`.

- Migration step:
  ```sql
  update public.tenants
  set is_personal = true
  where slug like 'user-%';
  ```
- This marks all already-migrated personal tenants without changing org tenants.

### 1.3 Helper Function: `create_or_get_personal_tenant`

Add a security-definer function in a new migration:

- Signature:
  ```sql
  create or replace function public.create_or_get_personal_tenant(p_user_id uuid)
  returns uuid
  language sql
  security definer
  set search_path = public
  set row_security = off
  as $$
    with existing as (
      select id
      from public.tenants
      where created_by = p_user_id
        and is_personal = true
      limit 1
    ),
    inserted as (
      insert into public.tenants (name, slug, status, created_by, is_personal)
      select
        'Personal',
        'user-' || p_user_id,
        'active',
        p_user_id,
        true
      where not exists (select 1 from existing)
      returning id
    ),
    target as (
      select id from existing
      union all
      select id from inserted
      limit 1
    )
    select id from target;
  $$;
  ```

- After tenant creation:
  - Insert `tenant_branding` row if it does not exist.
  - Insert `tenant_users` row with `role = 'TENANT_ADMIN'` if it does not exist.
  - These can be handled either inside the same function or via `insert ... on conflict do nothing` in a second function call.

- Expose via Supabase RPC so app code can call:
  - `supabase.rpc('create_or_get_personal_tenant', { p_user_id: session.user.id })`

### 1.4 Org Tenant Creation

- Ensure `/api/admin/tenants` (SUPER_ADMIN only) sets:
  - `is_personal = false` explicitly on insert.
- This keeps org workspaces clearly distinct from personal ones.

---

## 2. Backend Behavior

**Objective:** Guarantee every authenticated user has a personal workspace when needed, without breaking existing flows.

### 2.1 Tenant Context Helper

In `lib/tenant-context.ts`:

- Add helper:
  ```ts
  export async function ensurePersonalTenant(userId: string): Promise<string> {
    const supabase = await createServerClient()
    const { data, error } = await supabase.rpc('create_or_get_personal_tenant', {
      p_user_id: userId,
    })
    if (error || !data) {
      throw error ?? new Error('Failed to ensure personal tenant')
    }
    return data as string
  }
  ```

- Optionally integrate this into `ensureActiveTenant(userId)` to automatically prefer the user's personal tenant if no active tenant exists.

### 2.2 Agent Creation Flow

In `app/api/agents/route.ts` (POST):

1. After verifying the user is authenticated:
   - Call `ensurePersonalTenant(session.user.id)` to guarantee a personal tenant exists.
2. Resolve the tenant used for the new agent:
   - Either:
     - Use the value returned from `ensurePersonalTenant`, or
     - Call `getUserActiveTenant(session.user.id)` (which will now always find at least one tenant).
3. Use that `tenant_id` when inserting into `vibe_agents`.
4. Keep existing RLS logic: agents are scoped to members of that tenant.

Result: a brand-new user with no prior tenants can create agents without manual setup.

### 2.3 Eager Personal Tenant Creation (Optional)

To improve UX:

- In a central server component (e.g. `Header` or a root layout used for authenticated pages):
  - If `session.user.id` exists, call `ensurePersonalTenant(session.user.id)` once.
  - This ensures:
    - `TenantSwitcher` always has at least one tenant.
    - Tenant settings/pages do not hit "no tenant" edge cases.

---

## 3. Permissions & Rules

**Objective:** Personal workspaces are limited; org workspaces are fully featured.

### 3.1 Expose `is_personal` in APIs

- `GET /api/tenants/[id]/config`:
  - Include `tenant.is_personal` in response.
- `GET /api/admin/tenants` and `GET /api/admin/tenants/[id]`:
  - Include `is_personal` so admin UI can differentiate workspace types.

### 3.2 Branding & Features for Personal Tenants

- `PUT /api/tenants/[id]/branding`:
  - Load tenant; if `is_personal = true`, return 403:
    ```ts
    if (tenant.is_personal) {
      return NextResponse.json(
        { error: 'Branding is not configurable for personal workspaces.' },
        { status: 403 }
      )
    }
    ```

- `PUT /api/tenants/[id]/features`:
  - Same pattern: forbid updates when `is_personal = true`.

Effect: users see branding, but cannot modify it for personal workspaces.

### 3.3 Team & Invitations for Personal Tenants

- `POST /api/tenants/[id]/invitations`:
  - If `tenant.is_personal`, return 403:
    - "Personal workspaces cannot invite members."

- `GET /api/tenants/[id]/invitations`:
  - For `is_personal`:
    - Either:
      - Return empty list, or
      - Return 403.
    - UX preference: empty list + hidden UI.

- `PUT /api/tenants/[id]/users/[userId]/role` and `DELETE /api/tenants/[id]/users/[userId]/role`:
  - If `tenant.is_personal`, return 403.

Result: personal workspaces stay single-user regardless of API usage.

### 3.4 Superadmin Capabilities

- SUPER_ADMINs can:
  - Create org tenants (`is_personal = false`) via `/admin/tenants`.
  - Manage branding, features, team, and invitations for org tenants.
  - See which tenants are Personal vs Org in the admin UI.
- No changes required to `lib/permissions.ts`; role checks already rely on `tenant_users`.

---

## 4. UI Behavior

**Objective:** Clearly communicate workspace type and enforce read-only behavior for personal workspaces.

### 4.1 Tenant Settings UI (`app/settings/tenant/page.tsx`)

- After fetching config:
  - If `tenant.is_personal`:
    - Disable or hide branding input fields.
    - Disable the "Save Changes" button.
    - Show a note such as:
      > This is your personal workspace. Branding is only configurable for organization workspaces created by your team.

  - If `!tenant.is_personal`:
    - Keep existing editable branding behavior.

### 4.2 Team Management UI (`app/settings/tenant/team/page.tsx`)

- Obtain the current tenant (and `is_personal`) via existing APIs.
- If `is_personal`:
  - Hide "Invite Member" button.
  - Disable role change / removal actions.
  - Show note:
    > Personal workspaces do not support team members.

- If `!is_personal`:
  - Keep full team management and invitations UI.

### 4.3 Tenant Switcher (`components/tenants/tenant-switcher.tsx`)

- Use `tenant.is_personal` to label:
  - Personal tenant: "Personal" / "My workspace".
  - Org tenants: show normal `tenant.name`.

- Assume `ensurePersonalTenant` has been called for any authenticated user so the switcher always has at least one option.

### 4.4 Admin Dashboard (`app/admin/tenants/*`)

- Tenant list (`/admin/tenants`):
  - Add "Type" column:
    - "Personal" when `is_personal = true`.
    - "Org" otherwise.

- Tenant details (`/admin/tenants/[id]`):
  - Display badge:
    - "Personal workspace" vs "Organization workspace".
  - Optionally restrict certain destructive actions for personal tenants, or allow SUPER_ADMIN to manage them fully (product decision).

---

## 5. Signup & First-Time User Experience

**Objective:** A brand-new user can create agents immediately without manual workspace setup.

### 5.1 Flow Summary

1. User signs up via Supabase Auth and logs in.
2. On first authenticated action that requires a tenant (e.g. creating an agent, viewing settings):
   - Backend calls `create_or_get_personal_tenant(user_id)` via `ensurePersonalTenant`.
3. A personal workspace is created if it does not already exist.
4. User can:
   - Create agents (they belong to the personal tenant).
   - See `Tenant Settings` but branding/team is read-only for personal workspace.
5. SUPER_ADMINs can:
   - Create org workspaces for teams.
   - Configure branding and invite members into those org tenants.

---

## 6. Implementation Order

Recommended implementation sequence:

1. **Migration:** Add `is_personal` and mark existing personal tenants.
2. **Function:** Implement `create_or_get_personal_tenant` and wire it as RPC.
3. **Helpers:** Add `ensurePersonalTenant` to `lib/tenant-context.ts`.
4. **Agents API:** Update `POST /api/agents` to guarantee a tenant.
5. **APIs:** Enforce `is_personal` rules in branding, features, team, and invitations endpoints.
6. **UI:** Update settings, team management, tenant switcher, and admin tenants UI to reflect workspace types.
7. **Polish:** Test flows for:
   - New users.
   - Existing migrated users.
   - SUPER_ADMINs managing org workspaces.

