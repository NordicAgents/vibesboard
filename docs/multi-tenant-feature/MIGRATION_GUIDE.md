# Multi-Tenant System - Migration Guide

## Overview

This guide walks you through applying the multi-tenant migration to your VibeAgent database. The migration is designed to be **safe and reversible**, with automatic data migration for existing users.

## Pre-Migration Checklist

Before running the migration, ensure:

- [ ] You have a **backup** of your database
- [ ] Supabase CLI is installed and configured
- [ ] You're connected to the correct Supabase project
- [ ] You have admin access to your Supabase dashboard
- [ ] Your local codebase is up to date

## What the Migration Does

### Creates New Tables
1. `tenants` - Organizational units
2. `tenant_branding` - Logo and color customization
3. `feature_flags` - Global feature definitions
4. `tenant_feature_toggles` - Tenant-specific overrides
5. `tenant_users` - User-to-tenant role mappings
6. `invitations` - Pending tenant invitations

### Modifies Existing Tables
- Adds `tenant_id` column to `vibe_agents`

### Migrates Existing Data
- Creates a personal tenant for each existing user
- Associates all user's agents with their personal tenant
- Assigns users as TENANT_ADMIN of their personal tenant
- Creates default branding for each tenant

### Sets Up Security
- Enables Row Level Security on all new tables
- Creates comprehensive RLS policies
- Updates agent policies for multi-tenant access

## Step-by-Step Migration

### Step 1: Review the Migration

```bash
cd /Users/mx/Documents/Work/MX/vibeagent

# View the migration file
cat supabase/migrations/20251122000000_multi_tenant_system.sql
```

Read through and understand what will be changed.

### Step 2: Backup Your Database

**Option A: Using Supabase CLI**
```bash
# Create a backup
supabase db dump -f backup_$(date +%Y%m%d_%H%M%S).sql
```

**Option B: Using Supabase Dashboard**
1. Go to Database → Backups
2. Create a manual backup
3. Wait for backup to complete

### Step 3: Test in Development First

If possible, test in a development environment:

```bash
# Point to dev project
supabase link --project-ref your-dev-project

# Run migration
supabase db push

# Test the changes
# Verify data migration worked
# Test API endpoints
```

### Step 4: Run the Migration

**Using Supabase CLI (Recommended)**
```bash
# Ensure you're connected to the right project
supabase status

# Run the migration
supabase db push
```

**Using Supabase Dashboard (Alternative)**
1. Go to SQL Editor
2. Copy contents of `20251122000000_multi_tenant_system.sql`
3. Paste into SQL editor
4. Execute the migration

### Step 5: Verify the Migration

Run these queries to verify:

```sql
-- Check new tables exist
SELECT tablename FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('tenants', 'tenant_branding', 'feature_flags', 'tenant_feature_toggles', 'tenant_users', 'invitations');

-- Check tenant_id was added to vibe_agents
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'vibe_agents' 
AND column_name = 'tenant_id';

-- Check personal tenants were created
SELECT COUNT(*) as tenant_count FROM tenants;
SELECT COUNT(*) as user_count FROM tenant_users;

-- Verify data migration
SELECT 
  u.email,
  t.name as tenant_name,
  t.slug,
  tu.role,
  COUNT(va.id) as agent_count
FROM auth.users u
JOIN tenant_users tu ON tu.user_id = u.id
JOIN tenants t ON t.id = tu.tenant_id
LEFT JOIN vibe_agents va ON va.tenant_id = t.id
GROUP BY u.email, t.name, t.slug, tu.role;

-- Check feature flags
SELECT * FROM feature_flags;

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
AND tablename IN ('tenants', 'tenant_branding', 'feature_flags', 'tenant_feature_toggles', 'tenant_users', 'invitations');
```

### Step 6: Assign Super Admin Role

Replace `YOUR_USER_ID` with your actual user ID:

```sql
-- First, find your user ID
SELECT id, email FROM auth.users WHERE email = 'your-email@example.com';

-- Then assign super admin role
UPDATE tenant_users 
SET role = 'SUPER_ADMIN'
WHERE user_id = 'YOUR_USER_ID';

-- Verify
SELECT u.email, tu.role, t.name
FROM tenant_users tu
JOIN auth.users u ON u.id = tu.user_id
JOIN tenants t ON t.id = tu.tenant_id
WHERE tu.user_id = 'YOUR_USER_ID';
```

### Step 7: Test the System

1. **Test Authentication**
   ```bash
   # Try accessing tenant list
   curl http://localhost:3000/api/admin/tenants \
     -H "Cookie: your-session-cookie"
   ```

2. **Test Tenant Creation**
   ```bash
   curl -X POST http://localhost:3000/api/admin/tenants \
     -H "Cookie: your-session-cookie" \
     -H "Content-Type: application/json" \
     -d '{"name":"Test Tenant","slug":"test-tenant"}'
   ```

3. **Test Feature Flags**
   ```bash
   curl http://localhost:3000/api/admin/feature-flags \
     -H "Cookie: your-session-cookie"
   ```

4. **Test Invitation Flow**
   - Create an invitation via API
   - Try accessing the invitation URL
   - Test acceptance (with a test account)

5. **Test RLS Policies**
   - Try accessing another tenant's data
   - Verify you get forbidden errors
   - Test as different user roles

## Rollback Procedure

If you need to rollback the migration:

### Option 1: Using Migration Down Script

The migration includes a down script that will:
- Drop all new tables
- Remove tenant_id from vibe_agents
- Restore original agent RLS policies

```bash
# This will rollback the last migration
supabase db reset

# Or manually run the down script
supabase db execute -f <(grep -A 999 "migrate:down" supabase/migrations/20251122000000_multi_tenant_system.sql)
```

### Option 2: Restore from Backup

```bash
# Restore from your backup
supabase db restore backup_YYYYMMDD_HHMMSS.sql
```

### Option 3: Manual Cleanup

If needed, manually drop tables:

```sql
-- Drop tables in reverse order (respecting foreign keys)
DROP TABLE IF EXISTS invitations CASCADE;
DROP TABLE IF EXISTS tenant_users CASCADE;
DROP TABLE IF EXISTS tenant_feature_toggles CASCADE;
DROP TABLE IF EXISTS feature_flags CASCADE;
DROP TABLE IF EXISTS tenant_branding CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Remove tenant_id from vibe_agents
ALTER TABLE vibe_agents DROP COLUMN IF EXISTS tenant_id;

-- Restore original RLS policies
-- (See migration down script for full policy restoration)
```

## Post-Migration Tasks

After successful migration:

1. **Configure Environment Variables**
   ```bash
   # Add to .env.local
   NEXT_PUBLIC_APP_URL=https://your-domain.com
   ```

2. **Set Up Email Templates** (in Supabase Dashboard)
   - Go to Authentication → Email Templates
   - Create template for invitations
   - Use subject: "You've been invited to join {tenant_name}"
   - Include link: `{{.SiteURL}}/invite/{{.Token}}`

3. **Monitor Initial Usage**
   - Watch for any unusual errors
   - Check Supabase logs
   - Monitor database performance

4. **Update Documentation**
   - Document your super admin assignment
   - Update team on new multi-tenant features
   - Share invitation workflow

## Troubleshooting

### Migration Fails
**Error**: Foreign key constraint violation
**Solution**: Ensure no orphaned records exist. Clean up data before migration.

**Error**: Permission denied
**Solution**: Ensure you have necessary database permissions. Try running as service role.

### Data Migration Issues
**Error**: Tenant creation fails for some users
**Solution**: Check auth.users table for any NULL emails or invalid data.

**Error**: Agents not associated with tenants
**Solution**: Run this fix:
```sql
UPDATE vibe_agents va
SET tenant_id = (
  SELECT tu.tenant_id 
  FROM tenant_users tu 
  WHERE tu.user_id = va.user_id 
  LIMIT 1
)
WHERE tenant_id IS NULL;
```

### RLS Policy Issues
**Error**: Users can't access their data
**Solution**: 
1. Check RLS is enabled: `SELECT * FROM pg_tables WHERE rowsecurity = false;`
2. Verify user has tenant_users record
3. Check tenant_id matches

**Error**: "new row violates row-level security policy"
**Solution**: Ensure user has proper role in tenant_users before creating records.

### Performance Issues
**Error**: Slow queries after migration
**Solution**: Ensure indices are created:
```sql
-- These should already exist from migration
CREATE INDEX IF NOT EXISTS vibe_agents_tenant_id_idx ON vibe_agents(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_users_user_id_idx ON tenant_users(user_id);
CREATE INDEX IF NOT EXISTS tenant_users_tenant_id_idx ON tenant_users(tenant_id);
```

## Health Check Queries

Run these periodically to ensure system health:

```sql
-- Check for agents without tenants
SELECT COUNT(*) FROM vibe_agents WHERE tenant_id IS NULL;

-- Check for users without tenant membership
SELECT COUNT(*) 
FROM auth.users u 
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_users WHERE user_id = u.id
);

-- Check for orphaned tenant records
SELECT COUNT(*) 
FROM tenants t 
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_users WHERE tenant_id = t.id
);

-- Check invitation status distribution
SELECT status, COUNT(*) 
FROM invitations 
GROUP BY status;

-- Check tenant health
SELECT 
  t.name,
  t.status,
  COUNT(DISTINCT tu.user_id) as user_count,
  COUNT(DISTINCT va.id) as agent_count
FROM tenants t
LEFT JOIN tenant_users tu ON tu.tenant_id = t.id
LEFT JOIN vibe_agents va ON va.tenant_id = t.id
GROUP BY t.id, t.name, t.status;
```

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review Supabase logs in dashboard
3. Check application logs for errors
4. Consult the documentation in `docs/multi-tenant-feature/`

## Migration Checklist

- [ ] Database backed up
- [ ] Migration reviewed and understood
- [ ] Connected to correct Supabase project
- [ ] Migration executed successfully
- [ ] New tables created and populated
- [ ] Existing data migrated correctly
- [ ] RLS policies enabled
- [ ] Super admin assigned
- [ ] System tested and verified
- [ ] Environment variables configured
- [ ] Email templates set up (optional)
- [ ] Team notified of changes

---

**Estimated Migration Time**: 2-5 minutes for small databases (<1000 users)

**Downtime**: Zero downtime if using Supabase migrations (they're transactional)

**Risk Level**: Low (migration is reversible and includes data validation)
