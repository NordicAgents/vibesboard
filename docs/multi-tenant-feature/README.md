# Multi-Tenant System

This document describes the multi-tenant system implemented for VibeAgent.

## Overview

The multi-tenant system allows multiple organizations (tenants) to use the platform with complete data isolation, custom branding, and feature toggles. It supports role-based access control with three levels:

1. **SUPER_ADMIN** - Full system access, can manage all tenants
2. **TENANT_ADMIN** - Can manage their tenant's settings, users, and features
3. **MEMBER** - Regular tenant user with access to tenant resources

## Database Schema

### Tables

- **tenants** - Core tenant information
- **tenant_branding** - Logo and color customization per tenant
- **feature_flags** - Global feature definitions
- **tenant_feature_toggles** - Tenant-specific feature overrides
- **tenant_users** - User-to-tenant mapping with roles
- **invitations** - Pending invitations to join tenants

### Modifications

- **vibe_agents** - Added `tenant_id` column for multi-tenant support

## API Endpoints

### Admin APIs (SUPER_ADMIN only)

```
POST   /api/admin/tenants              # Create tenant
GET    /api/admin/tenants              # List all tenants
GET    /api/admin/tenants/[id]         # Get tenant details
PUT    /api/admin/tenants/[id]         # Update tenant
DELETE /api/admin/tenants/[id]         # Suspend tenant

GET    /api/admin/feature-flags        # List feature flags
POST   /api/admin/feature-flags        # Create feature flag
```

### Tenant Configuration APIs

```
GET    /api/tenants/[id]/config        # Get tenant configuration
PUT    /api/tenants/[id]/branding      # Update branding (ADMIN)
PUT    /api/tenants/[id]/features      # Toggle features (ADMIN)
GET    /api/tenants/[id]/users         # List members
PUT    /api/tenants/[id]/users/[userId]/role  # Update role (ADMIN)
DELETE /api/tenants/[id]/users/[userId]/role  # Remove member (ADMIN)
```

### Invitation APIs

```
POST   /api/tenants/[id]/invitations   # Create invitation (ADMIN)
GET    /api/tenants/[id]/invitations   # List invitations (ADMIN)
GET    /api/invitations/[token]        # Get invitation details
POST   /api/invitations/[token]/accept # Accept invitation
```

## Utility Functions

### Permissions (`lib/permissions.ts`)

```typescript
getUserRole(userId, tenantId)     // Get user's role in tenant
isSuperAdmin(userId)              // Check if super admin
isTenantAdmin(userId, tenantId)   // Check if tenant admin
canManageTenant(userId, tenantId) // Check management permissions
getUserTenants(userId)            // Get all user's tenants
isMemberOfTenant(userId, tenantId) // Check membership
```

### Features (`lib/features.ts`)

```typescript
isFeatureEnabled(tenantId, featureName)  // Check feature status
getEnabledFeatures(tenantId)             // Get all enabled features
getTenantFeatures(tenantId)              // Get features with details
toggleFeature(tenantId, flagId, enabled) // Toggle feature
```

### Tenant Context (`lib/tenant-context.ts`)

```typescript
getActiveTenantId()           // Get active tenant from cookie
setActiveTenantId(tenantId)   // Set active tenant
getActiveTenant()             // Get full tenant details
getActiveTenantBranding()     // Get branding config
getTenantContext(userId)      // Get complete context
ensureActiveTenant(userId)    // Auto-set if needed
```

### Validations (`lib/validations.ts`)

```typescript
validateTenantSlug(slug)                    // Validate slug format
validateTenantName(name)                    // Validate name
validateBrandingColors(primary, secondary)  // Validate hex colors
validateFeatureFlagName(name)               // Validate flag name
validateEmail(email)                        // Validate email
generateSlug(name)                          // Generate slug from name
```

## UI Components

Located in `components/tenants/`:

- **RoleBadge** - Display user roles with color coding
- **TenantCard** - Tenant information card
- **FeatureToggle** - Interactive feature switch
- **ColorPicker** - Hex color input with visual picker
- **BrandingPreview** - Live preview of branding
- **InvitationCard** - Invitation display card

## Default Feature Flags

1. **BETA_ANALYTICS** - Access to beta analytics dashboard (default: false)
2. **ADVANCED_TOOLS** - Advanced agent tools and integrations (default: false)
3. **CUSTOM_BRANDING** - Custom branding and white-labeling (default: true)
4. **API_ACCESS** - API access for programmatic control (default: false)
5. **TEAM_COLLABORATION** - Team features and shared workspaces (default: true)

## Setup Instructions

### 1. Run the Migration

```bash
# Using Supabase CLI
supabase db push

# Or apply manually in Supabase Dashboard
```

The migration will:
- Create all new tables with RLS policies
- Add tenant_id to vibe_agents
- Create personal tenants for existing users
- Insert default feature flags
- Set up database functions

### 2. Assign Super Admin

After migration, manually assign super admin role:

```sql
-- Replace with your user ID
INSERT INTO tenant_users (user_id, tenant_id, role)
VALUES (
  'your-user-id',
  (SELECT id FROM tenants WHERE created_by = 'your-user-id' LIMIT 1),
  'SUPER_ADMIN'
);
```

### 3. Environment Variables

Add to `.env.local`:

```bash
# App URL for invitation links
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Data Migration

The migration automatically:
1. Creates a personal tenant for each existing user with slug `user-{uuid}`
2. Sets the user as TENANT_ADMIN of their personal tenant
3. Associates all user's agents with their personal tenant
4. Creates default branding for each tenant

## Security

### Row Level Security (RLS)

All tables have RLS policies enforcing:
- Super admins can access all data
- Tenant admins can manage their tenant
- Members can read tenant data
- Agents are scoped to tenant members

### API Authentication

All API routes require authentication via Supabase Auth. Routes check:
1. User is authenticated
2. User has permission for the action
3. User has access to the tenant

### Invitation Security

- Tokens are cryptographically secure (32 bytes)
- Invitations expire after 7 days
- Users can't change their own roles
- Admins can't remove themselves from tenants

## Usage Examples

### Creating a Tenant (Super Admin)

```typescript
const response = await fetch('/api/admin/tenants', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Acme Corp',
    slug: 'acme-corp'
  })
})
```

### Inviting a User (Tenant Admin)

```typescript
const response = await fetch(`/api/tenants/${tenantId}/invitations`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    role: 'MEMBER'
  })
})
```

### Toggle a Feature

```typescript
const response = await fetch(`/api/tenants/${tenantId}/features`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    feature_flag_id: flagId,
    is_enabled: true
  })
})
```

### Check Feature in Code

```typescript
import { isFeatureEnabled } from '@/lib/features'

const hasAnalytics = await isFeatureEnabled(tenantId, 'BETA_ANALYTICS')

if (hasAnalytics) {
  // Show analytics dashboard
}
```

## UI Pages Status

- ⏳ Admin dashboard (`app/admin/*`) - TODO
- ⏳ Tenant settings (`app/settings/tenant/*`) - TODO  
- ⏳ Invitation acceptance (`app/invite/[token]/*`) - TODO
- ⏳ Tenant switcher component - TODO

## Next Steps

1. Build the admin dashboard UI
2. Create tenant settings pages
3. Implement invitation acceptance flow
4. Add tenant switcher to header
5. Update agent pages to use tenant context
6. Configure Supabase email templates
7. Add comprehensive testing
8. Performance optimization (caching, indices)

## Support

For questions or issues, refer to the implementation plan:
- `docs/multi-tenant-feature/multi-tenant-system.md` - Original plan
- `docs/multi-tenant-feature/IMPLEMENTATION_PROGRESS.md` - Progress tracker
