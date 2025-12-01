# Multi-Tenant System - Quick Reference

## 🚀 Quick Commands

### Database
```bash
# Run migration
supabase db push

# Reset database (caution!)
supabase db reset

# Check migration status
supabase migration list
```

### Super Admin Setup
```sql
-- Make yourself super admin
UPDATE tenant_users 
SET role = 'SUPER_ADMIN'
WHERE user_id = 'YOUR_USER_ID';

-- Check super admins
SELECT u.email, tu.role, t.name as tenant_name
FROM tenant_users tu
JOIN auth.users u ON u.id = tu.user_id
JOIN tenants t ON t.id = tu.tenant_id
WHERE tu.role = 'SUPER_ADMIN';
```

## 📡 API Cheat Sheet

### Headers
```
Cookie: your-session-cookie
Content-Type: application/json
```

### Create Tenant
```bash
POST /api/admin/tenants
{
  "name": "Acme Corp",
  "slug": "acme-corp"
}
```

### List Tenants
```bash
GET /api/admin/tenants?page=1&limit=10&status=active
```

### Update Branding
```bash
PUT /api/tenants/:id/branding
{
  "logo_url": "https://example.com/logo.png",
  "primary_color": "#FF5733",
  "secondary_color": "#FFFFFF"
}
```

### Toggle Feature
```bash
PUT /api/tenants/:id/features
{
  "feature_flag_id": "uuid-here",
  "is_enabled": true
}
```

### Invite User
```bash
POST /api/tenants/:id/invitations
{
  "email": "user@example.com",
  "role": "MEMBER"
}
```

### Accept Invitation
```bash
POST /api/invitations/:token/accept
```

## 🔧 Component Usage

### Role Badge
```tsx
import { RoleBadge } from '@/components/tenants'

<RoleBadge role="TENANT_ADMIN" />
```

### Tenant Card
```tsx
import { TenantCard } from '@/components/tenants'

<TenantCard 
  tenant={tenant}
  userCount={5}
  showActions
  onEdit={handleEdit}
/>
```

### Feature Toggle
```tsx
import { FeatureToggle } from '@/components/tenants'

<FeatureToggle
  id={feature.id}
  name={feature.name}
  description={feature.description}
  isEnabled={feature.isEnabled}
  onToggle={handleToggle}
/>
```

### Feature Gate
```tsx
import { FeatureGate } from '@/components/tenants'

<FeatureGate 
  feature="BETA_ANALYTICS" 
  tenantId={tenantId}
  fallback={<div>Upgrade to access analytics</div>}
>
  <AnalyticsDashboard />
</FeatureGate>
```

### Tenant Switcher
```tsx
import { TenantSwitcher } from '@/components/tenants'

<TenantSwitcher
  tenants={userTenants}
  currentTenantId={activeTenantId}
/>
```

### Color Picker
```tsx
import { ColorPicker } from '@/components/tenants'

<ColorPicker
  label="Primary Color"
  value={primaryColor}
  onChange={setPrimaryColor}
/>
```

## 🛠️ Utility Functions

### Check Permissions
```tsx
import { isSuperAdmin, isTenantAdmin, getUserRole } from '@/lib/permissions'

const isSuper = await isSuperAdmin(userId)
const isAdmin = await isTenantAdmin(userId, tenantId)
const role = await getUserRole(userId, tenantId)
```

### Feature Flags
```tsx
import { isFeatureEnabled, getEnabledFeatures } from '@/lib/features'

const hasAnalytics = await isFeatureEnabled(tenantId, 'BETA_ANALYTICS')
const features = await getEnabledFeatures(tenantId)
```

### Tenant Context
```tsx
import { getActiveTenant, getTenantContext } from '@/lib/tenant-context'

const tenant = await getActiveTenant()
const context = await getTenantContext(userId)
```

### Validations
```tsx
import { validateTenantSlug, generateSlug } from '@/lib/validations'

const isValid = validateTenantSlug('acme-corp')
const slug = generateSlug('Acme Corporation')  // => 'acme-corporation'
```

## 🗄️ Database Queries

### Get User's Tenants
```sql
SELECT t.*, tu.role
FROM tenants t
JOIN tenant_users tu ON tu.tenant_id = t.id
WHERE tu.user_id = 'USER_ID';
```

### Get Tenant Members
```sql
SELECT u.email, tu.role, tu.created_at
FROM tenant_users tu
JOIN auth.users u ON u.id = tu.user_id
WHERE tu.tenant_id = 'TENANT_ID';
```

### Get Enabled Features
```sql
SELECT ff.name, 
       COALESCE(tft.is_enabled, ff.default_value) as is_enabled
FROM feature_flags ff
LEFT JOIN tenant_feature_toggles tft 
  ON tft.feature_flag_id = ff.id 
  AND tft.tenant_id = 'TENANT_ID';
```

### Get Pending Invitations
```sql
SELECT i.*, t.name as tenant_name
FROM invitations i
JOIN tenants t ON t.id = i.tenant_id
WHERE i.email = 'user@example.com'
  AND i.status = 'pending'
  AND i.expires_at > NOW();
```

## 🔐 Security Checklist

- [ ] Super admin assigned
- [ ] RLS policies enabled on all tables
- [ ] Migration ran successfully
- [ ] API routes test authenticated access
- [ ] Invitation tokens are secure
- [ ] Users can't modify own roles
- [ ] Tenant data is isolated
- [ ] Feature flags work correctly

## 🐛 Troubleshooting

### "Unauthorized" on API calls
- Check session cookie is present
- Verify user is authenticated
- Check user has required role

### "Forbidden" errors
- Verify user is member of tenant
- Check user's role in tenant_users
- Ensure super admin role is set correctly

### Features not working
- Check feature flag exists
- Verify tenant_feature_toggles entries
- Test with `is_feature_enabled()` function

### Migration issues
- Check Supabase connection
- Review migration logs
- Verify no conflicting data

## 📊 Monitoring Queries

### Count tenants by status
```sql
SELECT status, COUNT(*) 
FROM tenants 
GROUP BY status;
```

### Active invitations
```sql
SELECT t.name, COUNT(*) as pending_invites
FROM invitations i
JOIN tenants t ON t.id = i.tenant_id
WHERE i.status = 'pending'
GROUP BY t.name;
```

### Users per tenant
```sql
SELECT t.name, COUNT(*) as user_count
FROM tenants t
LEFT JOIN tenant_users tu ON tu.tenant_id = t.id
GROUP BY t.id, t.name
ORDER BY user_count DESC;
```

## 🎯 Testing Checklist

- [ ] Create tenant as super admin
- [ ] Update tenant branding
- [ ] Toggle feature flags
- [ ] Invite user to tenant
- [ ] Accept invitation
- [ ] Switch between tenants
- [ ] Create agent in tenant
- [ ] Verify RLS isolation
- [ ] Test all API endpoints
- [ ] Check permission boundaries

## 📚 Related Files

- Migration: `supabase/migrations/20251122000000_multi_tenant_system.sql`
- Types: `lib/db_types.ts`
- Permissions: `lib/permissions.ts`
- Features: `lib/features.ts`
- Validations: `lib/validations.ts`
- Context: `lib/tenant-context.ts`
- Components: `components/tenants/*`
- APIs: `app/api/admin/*`, `app/api/tenants/*`, `app/api/invitations/*`
