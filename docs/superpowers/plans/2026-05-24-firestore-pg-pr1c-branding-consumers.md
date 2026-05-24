# Firestore→Postgres PR 1c: Branding Consumers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Close the branding data-source split PR 1b surfaced — migrate `admin/platform-branding` (GET/PUT) and `tenants/[id]/config` (branding read) onto Postgres.

**Architecture:** Reuse `@vibesboard/tenants` branding helpers (add `upsertPlatformBranding`). `platformBranding` is a singleton — write/read a fixed sentinel-id row. Routes stay thin, pass `getMigrateDb()`. Reuse `getTenantById`, `getTenantBranding`, `getBaseBranding`, `resolveEffectiveBranding`.

**Tech Stack:** TS ESM, Drizzle, `node:test`, pnpm. Postgres must be running.

**Scope:** `packages/tenants/src/branding.ts` (+`upsertPlatformBranding`), `apps/web/app/api/admin/platform-branding/route.ts`, `apps/web/app/api/tenants/[id]/config/route.ts`.

---

## Task 1: `upsertPlatformBranding` helper (TDD)

**Files:** Modify `packages/tenants/src/branding.ts`; Test add to `packages/tenants/src/__tests__/branding.test.ts`.

- [ ] **Step 1: Add failing tests** (append a describe block to `branding.test.ts`):

```ts
import { upsertPlatformBranding, PLATFORM_BRANDING_ID } from '../branding.ts'

describe('upsertPlatformBranding', () => {
  test('inserts the singleton then updates it (stays one row)', async () => {
    await withTestDb(async ({ adminDb }) => {
      await upsertPlatformBranding(adminDb, { primaryColor: '#111111', secondaryColor: '#222222', logoUrl: null, updatedBy: null })
      let got = await getPlatformBranding(adminDb)
      assert.deepEqual(got, { primaryColor: '#111111', secondaryColor: '#222222', logoUrl: undefined })

      await upsertPlatformBranding(adminDb, { primaryColor: '#333333', secondaryColor: '#444444', logoUrl: 'https://x/l.png', updatedBy: null })
      got = await getPlatformBranding(adminDb)
      assert.deepEqual(got, { primaryColor: '#333333', secondaryColor: '#444444', logoUrl: 'https://x/l.png' })

      const { platformBranding } = await import('@vibesboard/adapter-postgres/schema')
      const rows = await adminDb.select().from(platformBranding)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].id, PLATFORM_BRANDING_ID)
    })
  })
})
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @vibesboard/tenants test` → FAIL (export missing).

- [ ] **Step 3: Implement** — add to `packages/tenants/src/branding.ts`:

```ts
/** Fixed sentinel id for the platform_branding singleton row. */
export const PLATFORM_BRANDING_ID = '00000000-0000-0000-0000-000000000001'

export interface UpsertPlatformBrandingInput {
  primaryColor: string
  secondaryColor: string
  logoUrl: string | null
  updatedBy: string | null
}

/** Insert or update the platform branding singleton (fixed sentinel id). */
export async function upsertPlatformBranding(
  db: Db,
  input: UpsertPlatformBrandingInput,
): Promise<void> {
  await db
    .insert(platformBranding)
    .values({
      id: PLATFORM_BRANDING_ID,
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      logoUrl: input.logoUrl,
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: platformBranding.id,
      set: {
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        logoUrl: input.logoUrl,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
}
```

- [ ] **Step 4: Run tests + type-check** — all pass, clean.

- [ ] **Step 5: Commit** — `git add packages/tenants/src/branding.ts packages/tenants/src/__tests__/branding.test.ts && git commit -m "feat(tenants): upsertPlatformBranding singleton helper"`

---

## Task 2: Migrate `admin/platform-branding/route.ts`

**Files:** Modify `apps/web/app/api/admin/platform-branding/route.ts`.

- [ ] **Step 1: Replace the whole file:**

```ts
import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getPlatformBranding, upsertPlatformBranding } from '@vibesboard/tenants'
import { validateBrandingColors, validateUrl } from '@/lib/validations'
import { invalidateBaseBrandingCache } from '@/lib/base-branding'

export const runtime = 'nodejs'

/** GET /api/admin/platform-branding — SUPER_ADMIN only */
export async function GET() {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const branding = await getPlatformBranding(getMigrateDb())
  return NextResponse.json({ branding })
}

/** PUT /api/admin/platform-branding — SUPER_ADMIN only */
export async function PUT(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const logoUrl = body.logoUrl ?? body.logo_url
  const primaryColor = body.primaryColor ?? body.primary_color
  const secondaryColor = body.secondaryColor ?? body.secondary_color

  if (!primaryColor || !secondaryColor) {
    return NextResponse.json(
      { error: 'primaryColor and secondaryColor are required' },
      { status: 400 },
    )
  }
  if (!validateBrandingColors(primaryColor, secondaryColor)) {
    return NextResponse.json(
      { error: 'Invalid color format. Use hex colors (e.g., #000000)' },
      { status: 400 },
    )
  }
  const isRelativeLogoPath = logoUrl && logoUrl.startsWith('/api/tenants/')
  if (logoUrl && logoUrl !== '' && !isRelativeLogoPath && !validateUrl(logoUrl)) {
    return NextResponse.json({ error: 'Invalid logo URL format' }, { status: 400 })
  }

  await upsertPlatformBranding(getMigrateDb(), {
    primaryColor,
    secondaryColor,
    logoUrl: logoUrl || null,
    updatedBy: auth.user.id,
  })
  invalidateBaseBrandingCache()

  return NextResponse.json({
    branding: { primaryColor, secondaryColor, logoUrl: logoUrl || null },
  })
}
```

- [ ] **Step 2: Type-check + grep** — `pnpm --filter @vibesboard/web type-check` PASS; `grep -n "adminDb\|firebase-admin\|Collections" "apps/web/app/api/admin/platform-branding/route.ts"` → none.

- [ ] **Step 3: Commit** — `git add "apps/web/app/api/admin/platform-branding/route.ts" && git commit -m "feat(branding): platform-branding admin route on Postgres (fixes no-op write)"`

---

## Task 3: Migrate `tenants/[id]/config/route.ts`

**Files:** Modify `apps/web/app/api/tenants/[id]/config/route.ts`.

- [ ] **Step 1: Replace the whole file:**

```ts
import { NextResponse } from 'next/server'
import { requireTenantMember, requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantBranding } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { getTenantFeatures } from '@vibesboard/policy/features'
import { getBaseBranding, resolveEffectiveBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/** GET /api/tenants/[id]/config — tenant config (features + branding). */
export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params

  // Super admins can read any tenant; otherwise must be a member.
  const superAdminAuth = await requireSuperAdmin()
  if (!superAdminAuth.ok) {
    const auth = await requireTenantMember(tenantId)
    if (!auth.ok) return auth.response
  }

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  const [brandingRow, baseBranding] = await Promise.all([
    getTenantBranding(getMigrateDb(), tenantId),
    getBaseBranding(),
  ])

  const effectiveBranding = resolveEffectiveBranding(
    brandingRow
      ? ({
          primaryColor: brandingRow.primaryColor,
          secondaryColor: brandingRow.secondaryColor,
          logoUrl: brandingRow.logoUrl ?? undefined,
          overrides: brandingRow.overrides ?? undefined,
        } as Parameters<typeof resolveEffectiveBranding>[0])
      : null,
    baseBranding,
  )

  const features = await getTenantFeatures(tenantId)

  return NextResponse.json({
    tenant: { ...tenant, branding: effectiveBranding, features },
    branding: effectiveBranding,
    baseBranding,
    overrides: brandingRow?.overrides ?? null,
    features,
  })
}
```

- [ ] **Step 2: Type-check + grep** — PASS; no `adminDb`/`Collections` in the file.

- [ ] **Step 3: Commit** — `git add "apps/web/app/api/tenants/[id]/config/route.ts" && git commit -m "feat(branding): tenant config route reads branding from Postgres"`

---

## Task 4: Verify

- [ ] `pnpm --filter @vibesboard/tenants test` → all pass.
- [ ] `pnpm type-check` → clean.
- [ ] `pnpm lint` → 0 errors.
- [ ] `grep -rn "adminDb\|firebase-admin/firestore" "apps/web/app/api/admin/platform-branding" "apps/web/app/api/tenants/[id]/config"` → none.
- [ ] **Staging e2e (after deploy), the key roundtrip:** as SUPER_ADMIN, `PUT /api/admin/platform-branding` with a primary color → then `GET /api/admin/platform-branding` reflects it → and a tenant with no overrides shows the new base color via `GET /api/tenants/[id]/branding` (proving write→read now share Postgres — the no-op is fixed). Note: the staging e2e user is not SUPER_ADMIN; set `users.is_super_admin=true` for the test user on the VM first, or test via a direct DB check of the `platform_branding` row after the PUT.

---

## Notes
- `getPlatformBranding` returns the fallback (not null) when unset — the admin GET now returns effective base rather than `null`; acceptable/better.
- `platformBranding` singleton is enforced at app level via the fixed `PLATFORM_BRANDING_ID`.
- `getTenantFeatures` is a no-op shim (returns []); unchanged.
