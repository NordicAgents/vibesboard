<!-- 4c10c6e6-7d28-4b1b-a10a-3c0bc1366b89 16a6e1ea-709e-4cea-a01e-f233a73b56dd -->
# Multi-Tenant System Implementation Plan

## Phase 1: Database Schema & Migrations

### New Tables

Create migration file `supabase/migrations/[timestamp]_multi_tenant_system.sql`:

**tenants**

- id (uuid, PK)
- name (text)
- slug (text, unique)
- status (text: 'active', 'trial', 'suspended')
- created_by (uuid, FK to auth.users)
- created_at, updated_at (timestamptz)

**tenant_branding**

- id (uuid, PK)
- tenant_id (uuid, FK to tenants)
- logo_url (text, nullable)
- primary_color (text, default '#000000')
- secondary_color (text, default '#ffffff')
- created_at, updated_at (timestamptz)

**feature_flags**

- id (uuid, PK)
- name (text, unique)
- description (text)
- default_value (boolean)
- created_at (timestamptz)

**tenant_feature_toggles**

- tenant_id (uuid, FK to tenants)
- feature_flag_id (uuid, FK to feature_flags)
- is_enabled (boolean)
- created_at, updated_at (timestamptz)
- PK (tenant_id, feature_flag_id)

**tenant_users**

- user_id (uuid, FK to auth.users)
- tenant_id (uuid, FK to tenants)
- role (text: 'SUPER_ADMIN', 'TENANT_ADMIN', 'MEMBER')
- created_at (timestamptz)
- PK (user_id, tenant_id)

**invitations**

- id (uuid, PK)
- email (text)
- tenant_id (uuid, FK to tenants)
- token (text, unique)
- role (text: 'TENANT_ADMIN', 'MEMBER')
- status (text: 'pending', 'accepted', 'expired')
- expires_at (timestamptz)
- created_by (uuid, FK to auth.users)
- created_at (timestamptz)

### Schema Modifications

- Add `tenant_id` (uuid, FK to tenants) to `vibe_agents` table
- Update `vibe_agents` RLS policies to check tenant membership

### Data Migration

Create migration to handle existing data:

- Create personal tenant for each existing user (slug: `user-{uuid}`)
- Create tenant_users record with TENANT_ADMIN role
- Update vibe_agents.tenant_id to match user's personal tenant
- Create super_admin role assignment via seed data

### RLS Policies

- tenants: SUPER_ADMIN full access, members can read their own
- tenant_branding: SUPER_ADMIN + TENANT_ADMIN can manage, members read
- feature_flags: SUPER_ADMIN full access, all authenticated read
- tenant_feature_toggles: SUPER_ADMIN + TENANT_ADMIN manage, members read
- tenant_users: SUPER_ADMIN + TENANT_ADMIN manage, members read own tenant
- invitations: TENANT_ADMIN create/read for their tenant
- vibe_agents: Scoped to tenant members instead of individual owners

### Type Definitions

Update `lib/db_types.ts` with new table types.

## Phase 2: Permission System & Utilities

### Permission Helpers (`lib/permissions.ts`)

```typescript
- getUserRole(userId, tenantId): Promise<Role | null>
- isSuperAdmin(userId): Promise<boolean>
- isTenantAdmin(userId, tenantId): Promise<boolean>
- canManageTenant(userId, tenantId): Promise<boolean>
- getUserTenants(userId): Promise<Tenant[]>
```

### Middleware Enhancement (`lib/tenant-context.ts`)

- Create helper to extract tenant context from URL/headers
- Store active tenant in request context

### Validation Utilities (`lib/validations.ts`)

- validateTenantSlug(slug): boolean
- validateBrandingColors(primary, secondary): boolean
- validateFeatureFlagName(name): boolean

## Phase 3: API Routes

### Tenant Management APIs

**POST /api/admin/tenants**

- Create new tenant (SUPER_ADMIN only)
- Validate name uniqueness and slug format
- Auto-create tenant_branding record
- Body: `{ name, slug, created_by }`

**GET /api/admin/tenants**

- List all tenants (SUPER_ADMIN only)
- Include tenant status, user count, created date
- Support pagination/filtering

**GET /api/admin/tenants/[id]**

- Get single tenant details (SUPER_ADMIN or tenant member)

**PUT /api/admin/tenants/[id]**

- Update tenant (SUPER_ADMIN only)
- Update name, slug, status

**DELETE /api/admin/tenants/[id]**

- Soft delete tenant (SUPER_ADMIN only)

### Configuration APIs

**GET /api/tenants/[id]/config**

- Get tenant configuration (SUPER_ADMIN, TENANT_ADMIN, MEMBER)
- Returns features and branding

**PUT /api/tenants/[id]/branding**

- Update branding (SUPER_ADMIN, TENANT_ADMIN)
- Validate logo URL and hex colors
- Body: `{ logo_url?, primary_color?, secondary_color? }`

**PUT /api/tenants/[id]/features**

- Toggle features (SUPER_ADMIN, TENANT_ADMIN)
- Body: `{ feature_flag_id, is_enabled }`

**GET /api/tenants/[id]/users**

- List tenant members (SUPER_ADMIN, TENANT_ADMIN, MEMBER)

**PUT /api/tenants/[id]/users/[userId]/role**

- Update member role (SUPER_ADMIN, TENANT_ADMIN)
- Body: `{ role: 'TENANT_ADMIN' | 'MEMBER' }`

### Invitation APIs

**POST /api/tenants/[id]/invitations**

- Create invitation (TENANT_ADMIN)
- Generate secure token, set expiry (7 days)
- Trigger Supabase Auth email with magic link
- Body: `{ email, role }`

**GET /api/invitations/[token]**

- Get invitation details (public)
- Return tenant name, inviter, role

**POST /api/invitations/[token]/accept**

- Accept invitation (authenticated user)
- Validate token, check expiry
- Create tenant_users record
- Mark invitation as accepted

**GET /api/user/invitations**

- List pending invitations for current user's email

### Feature Flag Management

**GET /api/admin/feature-flags**

- List all feature flags (SUPER_ADMIN)

**POST /api/admin/feature-flags**

- Create feature flag (SUPER_ADMIN)
- Body: `{ name, description, default_value }`

## Phase 4: Super-Admin Dashboard UI

### Layout Structure

Create `app/admin/layout.tsx`:

- Navigation sidebar with sections: Tenants, Feature Flags, Users
- Responsive design (collapsible on mobile)
- Protected route (SUPER_ADMIN only)

### Tenant List View (`app/admin/tenants/page.tsx`)

- Table with columns: Name, Slug, Status, Admin, Created Date, Actions
- Skeleton loaders during fetch
- Search/filter by status
- "Create Tenant" button → Dialog modal
- Row actions: View Details, Edit, Deactivate

### Create Tenant Dialog

- Radix Dialog with form fields: name, slug
- Slug auto-generation from name (with manual override)
- Validation feedback
- Calls POST /api/admin/tenants

### Tenant Detail View (`app/admin/tenants/[id]/page.tsx`)

- Radix Tabs: Overview, Features, Branding, Users, Agents
- Breadcrumb navigation

**Overview Tab:**

- Display: ID, Name, Slug, Status, Created By, Created Date
- Edit button for name/status

**Features Tab:**

- List of all feature flags as Switch components
- Each row: Feature name, description, toggle (enabled/disabled for this tenant)
- Shows default value if no override exists
- Calls PUT /api/tenants/[id]/features on toggle

**Branding Tab:**

- Logo URL input with preview
- Color pickers for primary/secondary colors (hex input + visual picker)
- Live preview card showing sample UI with applied colors
- Save button → PUT /api/tenants/[id]/branding

**Users Tab:**

- Table: Email, Role, Joined Date
- "Invite User" button → Dialog modal
- Role dropdown to change member roles
- Remove user action

**Agents Tab:**

- List agents belonging to this tenant
- Link to agent detail pages

### Feature Flags Management (`app/admin/feature-flags/page.tsx`)

- Table: Name, Description, Default Value
- "Create Feature Flag" button
- Edit/Delete actions

## Phase 5: Tenant Settings UI (For Tenant Admins)

### Layout (`app/settings/layout.tsx`)

- Protected route (TENANT_ADMIN or SUPER_ADMIN)
- Sidebar navigation

### Tenant Settings Page (`app/settings/tenant/page.tsx`)

- Similar structure to super-admin tenant detail view
- Tabs: Branding, Features, Team
- Scoped to current user's active tenant
- Cannot edit tenant name/slug (read-only)

### Team Management (`app/settings/tenant/team/page.tsx`)

- List team members
- Invite new members
- Manage roles (cannot change own role)

## Phase 6: Invitation Onboarding Flow

### Accept Invitation Page (`app/invite/[token]/page.tsx`)

- Public page that loads invitation details
- Shows: Tenant name, role being offered, inviter
- "Accept Invitation" button
- Redirects to sign-in if not authenticated
- On acceptance: calls POST /api/invitations/[token]/accept
- Redirects to tenant dashboard on success

### Invitation Email Template (Supabase)

- Configure Supabase email template
- Subject: "You've been invited to join {tenant_name}"
- Link: `{site_url}/invite/{token}`

### Post-Acceptance Experience

- Redirect to tenant's agent dashboard
- Toast notification: "Welcome to {tenant_name}!"
- First-time user tutorial (optional)

## Phase 7: Tenant Context & Feature Enforcement

### Active Tenant Selection

- For users in multiple tenants, add tenant switcher in header
- Store active tenant in cookie/local storage
- Update middleware to inject tenant context

### Feature Flag Enforcement

Create `lib/features.ts`:

```typescript
- isFeatureEnabled(tenantId, featureName): Promise<boolean>
- getEnabledFeatures(tenantId): Promise<string[]>
```

Wrap feature-gated UI components:

```typescript
<FeatureGate feature="BETA_ANALYTICS" fallback={null}>
  <AnalyticsDashboard />
</FeatureGate>
```

### Agent Access Control

- Update agent pages to verify user has tenant membership
- Display tenant branding (logo, colors) on agent interfaces
- Filter agent lists by current tenant

## Phase 8: UI Components & Styling

### New Components (in `components/tenants/`)

- `tenant-card.tsx`: Display tenant info card
- `tenant-switcher.tsx`: Dropdown to switch active tenant
- `role-badge.tsx`: Display user roles with colors
- `invitation-card.tsx`: Display invitation details
- `feature-toggle.tsx`: Feature flag switch component
- `branding-preview.tsx`: Live preview of branding
- `color-picker.tsx`: Hex color input with picker

### Theme Integration

- Ensure all dialogs/modals support dark/light theme
- Use existing theme toggle component
- Test branding colors in both themes

### Radix UI Components to Use

- Dialog: Tenant creation, user invitations
- Tabs: Tenant detail sections
- Switch: Feature toggles
- Select: Role selection dropdowns
- Separator: Section dividers
- Card: Grouping related settings

## Phase 9: Testing & Polish

### Manual Testing Checklist

- [ ] Super-admin can create tenants
- [ ] Super-admin can manage all tenant configurations
- [ ] Tenant admin can invite users
- [ ] Invitation email delivers correctly
- [ ] New user can accept invitation
- [ ] User gains correct tenant access
- [ ] Feature flags work correctly
- [ ] Branding applies to tenant UI
- [ ] RLS policies prevent unauthorized access
- [ ] Multi-tenant users can switch between tenants
- [ ] Agent access is tenant-scoped

### Accessibility Audit

- Keyboard navigation for all dialogs
- ARIA labels on interactive elements
- Color contrast meets WCAG standards
- Screen reader testing

### Performance

- Add indices for tenant_id lookups
- Implement pagination for large tenant lists
- Cache feature flag queries

### Documentation

- Update README with multi-tenant setup instructions
- Document environment variables for super-admin
- API documentation for all endpoints

### To-dos

- [ ] Create migration with all tenant tables and RLS policies
- [ ] Migrate existing users/agents to personal tenants
- [ ] Build permission checking utilities and tenant context
- [ ] Implement tenant CRUD and configuration APIs
- [ ] Build invitation creation and acceptance APIs
- [ ] Create super-admin dashboard layout and navigation
- [ ] Build tenant list page with create dialog
- [ ] Build tenant detail page with tabs for features/branding/users
- [ ] Create tenant settings pages for tenant admins
- [ ] Implement invitation acceptance page and email templates
- [ ] Add feature flag checking and tenant context to app
- [ ] Test all flows and add accessibility improvements