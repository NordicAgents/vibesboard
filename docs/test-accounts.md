# Test Accounts

Test accounts for verifying role-based access across the platform.

## Seed Script

```bash
# Create all test accounts
npx tsx scripts/seed-test-accounts.ts

# Preview without making changes
npx tsx scripts/seed-test-accounts.ts --dry-run

# Delete and recreate all test accounts
npx tsx scripts/seed-test-accounts.ts --reset
```

## Shared Team Tenant

| Field     | Value               |
|-----------|---------------------|
| Name      | Test Team Workspace |
| Slug      | `test-team`         |
| Personal? | No (team workspace) |
| Status    | Active              |

All three test users are members of this tenant with their respective roles.

---

## Accounts

### 1. Super Admin

| Field    | Value                              |
|----------|------------------------------------|
| Email    | `superadmin@test.vibeagent.com`    |
| Password | `TestAdmin123!`                    |
| Role     | `SUPER_ADMIN`                      |

**What to test:**
- Access to `/admin` panel (tenant management, feature flags, platform branding)
- Can view and manage all tenants
- Can grant/revoke super-admin to other users
- Can hard-delete tenants
- Has full access to every tenant's agents, conversations, and settings

---

### 2. Tenant Admin

| Field    | Value                              |
|----------|------------------------------------|
| Email    | `tenantadmin@test.vibeagent.com`   |
| Password | `TestAdmin123!`                    |
| Role     | `TENANT_ADMIN`                     |

**What to test:**
- Can create, edit, and delete agents within the team tenant
- Can invite new members and manage existing member roles
- Can manage tenant settings (branding, feature toggles)
- Can manage calendar connections, data connections, WhatsApp/Instagram accounts
- Can view usage & billing
- **Cannot** access `/admin` panel
- **Cannot** see other tenants' data

---

### 3. Team Member

| Field    | Value                              |
|----------|------------------------------------|
| Email    | `member@test.vibeagent.com`        |
| Password | `TestMember123!`                   |
| Role     | `MEMBER`                           |

**What to test:**
- Can view agents and chat with them
- Can create agents (if allowed by tenant config)
- Can view own conversations
- **Cannot** manage team members or invitations
- **Cannot** change tenant settings or branding
- **Cannot** access `/admin` panel
- **Cannot** delete other users' agents

---

## Quick Role-Permission Matrix

| Action                         | Super Admin | Tenant Admin | Member |
|--------------------------------|:-----------:|:------------:|:------:|
| Access `/admin` panel          | ✅          | ❌           | ❌     |
| Manage all tenants             | ✅          | ❌           | ❌     |
| Manage tenant settings         | ✅          | ✅           | ❌     |
| Invite / remove members        | ✅          | ✅           | ❌     |
| Change member roles            | ✅          | ✅           | ❌     |
| Create agents                  | ✅          | ✅           | ✅     |
| Edit/delete own agents         | ✅          | ✅           | ✅     |
| Edit/delete others' agents     | ✅          | ✅           | ❌     |
| Chat with agents               | ✅          | ✅           | ✅     |
| View conversations             | ✅          | ✅           | ✅     |
| Manage calendar connections    | ✅          | ✅           | ❌     |
| Manage WhatsApp/Instagram      | ✅          | ✅           | ❌     |
| View usage & billing           | ✅          | ✅           | ❌     |

---

## Notes

- Each user also gets a **personal workspace** auto-created by the `on-user-created` Cloud Function on first sign-up. The table above describes access within the **shared team tenant**.
- The seed script is idempotent — safe to run multiple times. Use `--reset` to fully recreate.
- These accounts use `@test.vibeagent.com` emails. They are Firebase Auth email/password accounts with `emailVerified: true`.
