# Firestore→Postgres PR 1b: Branding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Migrate platform + tenant branding (read/write) off Firestore onto Postgres, removing the last Firestore dependency from the RootLayout.

**Architecture:** Per the migration spec + PR 1a precedent: DB logic goes in `@vibesboard/tenants` (new `branding.ts`), tested with `withTestDb`; routes/lib stay thin and pass `getMigrateDb()`. The `tenantBranding` + `platformBranding` tables already exist. `resolveEffectiveBranding` is pure and stays in `lib/base-branding.ts`. `isFeatureEnabled` is already a no-op self-host shim (no Firestore) — no work there.

**Tech Stack:** TypeScript ESM, Drizzle (postgres-js), pgvector Postgres, `node:test`, pnpm.

**Prereq:** Postgres running (`pnpm db:up` + migrated). `@vibesboard/tenants` already exists from PR 1a.

**Scope (3 files migrated, 1 new helper module):**
- `lib/base-branding.ts` — `getBaseBranding()` → `platformBranding` table
- `app/api/tenants/[id]/branding/route.ts` — GET/PUT → `tenantBranding` table
- `lib/tenant-theme.ts` — tenant + branding reads → Postgres

**Shared types (exist in `@vibesboard/adapter-postgres/schema`):** `tenantBranding` { tenantId, logoUrl, primaryColor, secondaryColor, overrides (jsonb), createdAt, updatedAt }; `platformBranding` { id, logoUrl, primaryColor, secondaryColor, updatedBy, updatedAt }.

---

## Task 1: Branding DB helpers in `@vibesboard/tenants` (TDD)

**Files:**
- Create: `packages/tenants/src/branding.ts`
- Test: `packages/tenants/src/__tests__/branding.test.ts`
- Modify: `packages/tenants/src/index.ts`

- [ ] **Step 1: Write the failing test** `packages/tenants/src/__tests__/branding.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantBranding, platformBranding } from '@vibesboard/adapter-postgres/schema'
import {
  getPlatformBranding,
  getTenantBranding,
  upsertTenantBranding,
  PLATFORM_BRANDING_FALLBACK,
} from '../branding.ts'

async function seedTenant(adminDb: any) {
  const userId = uuidv7()
  const tenantId = uuidv7()
  await adminDb.insert(users).values({ id: userId, email: 'b@acme.com', name: 'B' })
  await adminDb.insert(tenants).values({ id: tenantId, name: 'Acme', slug: 'acme', createdBy: userId, isPersonal: false })
  return { userId, tenantId }
}

describe('getPlatformBranding', () => {
  test('returns the fallback when no platform_branding row exists', async () => {
    await withTestDb(async ({ adminDb }) => {
      const result = await getPlatformBranding(adminDb)
      assert.deepEqual(result, PLATFORM_BRANDING_FALLBACK)
    })
  })

  test('returns the stored platform branding row when present', async () => {
    await withTestDb(async ({ adminDb }) => {
      await adminDb.insert(platformBranding).values({
        id: uuidv7(), primaryColor: '#111111', secondaryColor: '#222222', logoUrl: 'https://x/logo.png',
      })
      const result = await getPlatformBranding(adminDb)
      assert.deepEqual(result, { primaryColor: '#111111', secondaryColor: '#222222', logoUrl: 'https://x/logo.png' })
    })
  })
})

describe('getTenantBranding', () => {
  test('returns null when the tenant has no branding row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      assert.equal(await getTenantBranding(adminDb, tenantId), null)
    })
  })

  test('returns the branding row with overrides when present', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await adminDb.insert(tenantBranding).values({
        tenantId, primaryColor: '#aaaaaa', secondaryColor: '#bbbbbb', overrides: ['primaryColor'],
      })
      const row = await getTenantBranding(adminDb, tenantId)
      assert.equal(row?.primaryColor, '#aaaaaa')
      assert.deepEqual(row?.overrides, ['primaryColor'])
    })
  })
})

describe('upsertTenantBranding', () => {
  test('inserts a branding row then updates it (upsert on tenant_id)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await upsertTenantBranding(adminDb, tenantId, {
        primaryColor: '#123456', secondaryColor: '#654321', logoUrl: null, overrides: ['primaryColor', 'secondaryColor'],
      })
      let rows = await adminDb.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId))
      assert.equal(rows.length, 1)
      assert.equal(rows[0].primaryColor, '#123456')
      assert.deepEqual(rows[0].overrides, ['primaryColor', 'secondaryColor'])

      await upsertTenantBranding(adminDb, tenantId, {
        primaryColor: '#000000', secondaryColor: '#ffffff', logoUrl: 'https://x/l.png', overrides: ['logoUrl'],
      })
      rows = await adminDb.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId))
      assert.equal(rows.length, 1) // still one row (upsert, not insert)
      assert.equal(rows[0].primaryColor, '#000000')
      assert.equal(rows[0].logoUrl, 'https://x/l.png')
      assert.deepEqual(rows[0].overrides, ['logoUrl'])
    })
  })
})
```

- [ ] **Step 2: Run, verify it fails**

Run: `pnpm --filter @vibesboard/tenants test`
Expected: FAIL — `Cannot find module '../branding.ts'`.

- [ ] **Step 3: Implement** `packages/tenants/src/branding.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenantBranding, platformBranding } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

export type BrandingField = 'logoUrl' | 'primaryColor' | 'secondaryColor'

export interface PlatformBranding {
  primaryColor: string
  secondaryColor: string
  logoUrl?: string
}

/** Used when no platform_branding row exists yet. */
export const PLATFORM_BRANDING_FALLBACK: PlatformBranding = {
  primaryColor: '#000000',
  secondaryColor: '#ffffff',
  logoUrl: undefined,
}

export interface TenantBrandingRow {
  tenantId: string
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
  overrides: BrandingField[] | null
}

export interface UpsertTenantBrandingInput {
  logoUrl: string | null
  primaryColor: string
  secondaryColor: string
  overrides: BrandingField[]
}

/** Platform-wide base branding (singleton table; one row). */
export async function getPlatformBranding(db: Db): Promise<PlatformBranding> {
  const rows = await db.select().from(platformBranding).limit(1)
  if (rows.length === 0) return PLATFORM_BRANDING_FALLBACK
  return {
    primaryColor: rows[0].primaryColor,
    secondaryColor: rows[0].secondaryColor,
    logoUrl: rows[0].logoUrl ?? undefined,
  }
}

/** A tenant's branding row, or null if it has none. */
export async function getTenantBranding(
  db: Db,
  tenantId: string,
): Promise<TenantBrandingRow | null> {
  const rows = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1)
  if (rows.length === 0) return null
  return {
    tenantId: rows[0].tenantId,
    logoUrl: rows[0].logoUrl,
    primaryColor: rows[0].primaryColor,
    secondaryColor: rows[0].secondaryColor,
    overrides: rows[0].overrides ?? null,
  }
}

/** Insert or update a tenant's branding (keyed by tenant_id). */
export async function upsertTenantBranding(
  db: Db,
  tenantId: string,
  input: UpsertTenantBrandingInput,
): Promise<void> {
  await db
    .insert(tenantBranding)
    .values({
      tenantId,
      logoUrl: input.logoUrl,
      primaryColor: input.primaryColor,
      secondaryColor: input.secondaryColor,
      overrides: input.overrides,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: tenantBranding.tenantId,
      set: {
        logoUrl: input.logoUrl,
        primaryColor: input.primaryColor,
        secondaryColor: input.secondaryColor,
        overrides: input.overrides,
        updatedAt: new Date(),
      },
    })
}
```

- [ ] **Step 4: Export from barrel** — append to `packages/tenants/src/index.ts`:

```ts
export * from './branding.ts'
```

- [ ] **Step 5: Run tests + type-check, verify pass**

Run: `pnpm --filter @vibesboard/tenants test && pnpm --filter @vibesboard/tenants type-check`
Expected: all tests pass (workspace + invitations + branding), type-check clean.

- [ ] **Step 6: Commit**

```bash
git add packages/tenants/src/branding.ts packages/tenants/src/index.ts packages/tenants/src/__tests__/branding.test.ts
git commit -m "feat(tenants): branding DB helpers (platform + tenant) on Postgres"
```

---

## Task 2: Migrate `lib/base-branding.ts` to Postgres

**Files:**
- Modify: `apps/web/lib/base-branding.ts`

`getBaseBranding()` reads Firestore today. Switch it to `getPlatformBranding(getMigrateDb())`, keeping the 60s cache and the pure `resolveEffectiveBranding` unchanged.

- [ ] **Step 1: Replace the Firestore read in `getBaseBranding`**

In `apps/web/lib/base-branding.ts`:
- Remove imports: `adminDb` from `@vibesboard/adapter-firebase/admin`, `Collections`, and `PlatformBrandingDocument` (no longer used).
- Add imports:

```ts
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getPlatformBranding } from '@vibesboard/tenants'
```

- Replace the body of `getBaseBranding()` (the cache check stays) so the fetch reads Postgres:

```ts
export async function getBaseBranding(): Promise<BaseBranding> {
  const now = Date.now()
  if (cachedBase && now < cacheExpiry) {
    return cachedBase
  }

  const platform = await getPlatformBranding(getMigrateDb())
  cachedBase = {
    primaryColor: platform.primaryColor,
    secondaryColor: platform.secondaryColor,
    logoUrl: platform.logoUrl || undefined,
  }

  cacheExpiry = now + 60_000
  return cachedBase
}
```

Keep `HARDCODED_FALLBACK`, `BaseBranding`, `invalidateBaseBrandingCache`, and `resolveEffectiveBranding` exactly as they are (the fallback now lives in `getPlatformBranding`, but leaving the local constant is harmless and keeps the type export). If `HARDCODED_FALLBACK` becomes unused and lint flags it, delete it.

- [ ] **Step 2: Type-check web**

Run: `pnpm --filter @vibesboard/web type-check`
Expected: PASS. (If `PlatformBrandingDocument`/`Collections`/`adminDb` were the only Firestore imports, they're now gone.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/base-branding.ts
git commit -m "feat(branding): base branding reads platform_branding table"
```

---

## Task 3: Migrate the branding route to Postgres

**Files:**
- Modify: `app/api/tenants/[id]/branding/route.ts`

Replace Firestore reads/writes with the Task-1 helpers + `getTenantById` (from `@/lib/tenant-context`, already on Postgres). Keep all validation, the personal-workspace 403, the overrides computation, and the response shape identical.

- [ ] **Step 1: Rewrite the route**

Replace the entire contents of `app/api/tenants/[id]/branding/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  getTenantBranding,
  upsertTenantBranding,
  type BrandingField,
} from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { validateBrandingColors, validateUrl } from '@/lib/validations'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getBaseBranding, resolveEffectiveBranding, type BaseBranding } from '@/lib/base-branding'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

// A TenantBrandingRow (or null) shaped for resolveEffectiveBranding, which
// expects { primaryColor, secondaryColor, logoUrl, overrides }.
function toResolverInput(
  row: Awaited<ReturnType<typeof getTenantBranding>>,
): Parameters<typeof resolveEffectiveBranding>[0] {
  if (!row) return null
  return {
    primaryColor: row.primaryColor,
    secondaryColor: row.secondaryColor,
    logoUrl: row.logoUrl ?? undefined,
    overrides: row.overrides ?? undefined,
  }
}

export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantMember(tenantId)
  if (!auth.ok) return auth.response

  const db = getMigrateDb()
  const [row, baseBranding] = await Promise.all([
    getTenantBranding(db, tenantId),
    getBaseBranding(),
  ])
  const effective = resolveEffectiveBranding(toResolverInput(row), baseBranding)

  return NextResponse.json({
    branding: effective,
    baseBranding,
    overrides: row?.overrides ?? null,
    raw: row,
  })
}

function parseBrandingBody(body: Record<string, unknown>) {
  return {
    logoUrl: (body.logo_url ?? body.logoUrl) as string | undefined,
    primaryColor: (body.primary_color ?? body.primaryColor) as string | undefined,
    secondaryColor: (body.secondary_color ?? body.secondaryColor) as string | undefined,
  }
}

function validateColors(
  primaryColor: string | undefined,
  secondaryColor: string | undefined,
): NextResponse | null {
  if (!primaryColor && !secondaryColor) return null
  if (validateBrandingColors(primaryColor || '#000000', secondaryColor || '#ffffff')) return null
  return NextResponse.json({ error: 'Invalid color format. Use hex colors (e.g., #000000)' }, { status: 400 })
}

function validateLogoUrl(logoUrl: string | undefined): NextResponse | null {
  if (!logoUrl || logoUrl === '') return null
  if (logoUrl.startsWith('/api/tenants/')) return null
  if (validateUrl(logoUrl)) return null
  return NextResponse.json({ error: 'Invalid logo URL format' }, { status: 400 })
}

function isFieldOverridden(effective: unknown, base: unknown): boolean {
  return effective !== undefined && effective !== base
}

// Which final fields differ from base branding (drives the overrides array).
function computeOverrides(
  next: { logoUrl: string | null; primaryColor: string; secondaryColor: string },
  baseBranding: BaseBranding,
): BrandingField[] {
  const fields: Array<{ key: BrandingField; effective: unknown; base: unknown }> = [
    { key: 'primaryColor', effective: next.primaryColor, base: baseBranding.primaryColor },
    { key: 'secondaryColor', effective: next.secondaryColor, base: baseBranding.secondaryColor },
    { key: 'logoUrl', effective: next.logoUrl ?? undefined, base: baseBranding.logoUrl ?? undefined },
  ]
  return fields.filter((f) => isFieldOverridden(f.effective, f.base)).map((f) => f.key)
}

export async function PUT(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const fields = parseBrandingBody(body)

  const colorError = validateColors(fields.primaryColor, fields.secondaryColor)
  if (colorError) return colorError
  const logoError = validateLogoUrl(fields.logoUrl)
  if (logoError) return logoError

  const db = getMigrateDb()

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (tenant.isPersonal) {
    return NextResponse.json(
      { error: 'Branding is not configurable for personal workspaces' },
      { status: 403 },
    )
  }

  if (auth.role !== 'SUPER_ADMIN') {
    const customBrandingEnabled = await isFeatureEnabled(tenantId, 'CUSTOM_BRANDING')
    if (!customBrandingEnabled) {
      return NextResponse.json(
        { error: 'Custom branding is disabled for this workspace' },
        { status: 403 },
      )
    }
  }

  if (
    fields.logoUrl === undefined &&
    fields.primaryColor === undefined &&
    fields.secondaryColor === undefined
  ) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const [existing, baseBranding] = await Promise.all([
    getTenantBranding(db, tenantId),
    getBaseBranding(),
  ])

  // Merge incoming fields over the existing row (or base branding defaults).
  const next = {
    logoUrl:
      fields.logoUrl !== undefined
        ? fields.logoUrl || null
        : (existing?.logoUrl ?? null),
    primaryColor: fields.primaryColor ?? existing?.primaryColor ?? baseBranding.primaryColor,
    secondaryColor: fields.secondaryColor ?? existing?.secondaryColor ?? baseBranding.secondaryColor,
  }
  const overrides = computeOverrides(next, baseBranding)

  await upsertTenantBranding(db, tenantId, { ...next, overrides })

  const effective = resolveEffectiveBranding(
    { primaryColor: next.primaryColor, secondaryColor: next.secondaryColor, logoUrl: next.logoUrl ?? undefined, overrides },
    baseBranding,
  )

  return NextResponse.json({ branding: effective, baseBranding, overrides })
}

export { PUT as PATCH }
```

- [ ] **Step 2: Type-check + confirm no Firestore**

Run: `pnpm --filter @vibesboard/web type-check`
Expected: PASS.
Run: `grep -n "adminDb\|firebase-admin\|Collections" "apps/web/app/api/tenants/[id]/branding/route.ts"`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/app/api/tenants/[id]/branding/route.ts"
git commit -m "feat(branding): tenant branding route uses Postgres helpers"
```

---

## Task 4: Migrate `lib/tenant-theme.ts` to Postgres

**Files:**
- Modify: `apps/web/lib/tenant-theme.ts`

Replace the two Firestore reads (tenant doc, branding doc) with `getTenantById` + `getTenantBranding`. Keep the CSS-var computation and the personal/feature-flag checks identical.

- [ ] **Step 1: Rewrite the data reads**

In `apps/web/lib/tenant-theme.ts`:
- Remove imports: `adminDb`, `Collections`, `TenantBrandingDocument`.
- Add imports:

```ts
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantBranding } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
```

- Replace the tenant + branding reads inside `getActiveTenantTheme`:

```ts
  const tenantId = await ensureActiveTenant(userId)
  if (!tenantId) return null

  const tenant = await getTenantById(tenantId)
  if (!tenant || tenant.isPersonal) {
    return null
  }

  const customBrandingEnabled = await isFeatureEnabled(tenantId, 'CUSTOM_BRANDING')
  if (!customBrandingEnabled) return null

  const db = getMigrateDb()
  const [brandingRow, baseBranding] = await Promise.all([
    getTenantBranding(db, tenantId),
    getBaseBranding(),
  ])

  const effective = resolveEffectiveBranding(
    brandingRow
      ? {
          primaryColor: brandingRow.primaryColor,
          secondaryColor: brandingRow.secondaryColor,
          logoUrl: brandingRow.logoUrl ?? undefined,
          overrides: brandingRow.overrides ?? undefined,
        }
      : null,
    baseBranding,
  )
```

The rest of the function (normalizeHex / hexToHslParts / cssVars / return) is unchanged.

- [ ] **Step 2: Type-check + confirm no Firestore**

Run: `pnpm --filter @vibesboard/web type-check`
Expected: PASS.
Run: `grep -n "adminDb\|firebase-admin\|Collections" apps/web/lib/tenant-theme.ts`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/tenant-theme.ts
git commit -m "feat(branding): tenant-theme reads tenant + branding from Postgres"
```

---

## Task 5: Full verification

- [ ] **Step 1: tenants package tests**

Run: `pnpm --filter @vibesboard/tenants test`
Expected: all pass (workspace + invitations + branding).

- [ ] **Step 2: Repo type-check**

Run: `pnpm type-check`
Expected: PASS.

- [ ] **Step 3: Lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: 0 errors. Run `pnpm --filter @vibesboard/web format:write` if format flags new files.

- [ ] **Step 4: No Firestore left in the branding domain**

Run: `grep -rn "adminDb\|firebase-admin/firestore" apps/web/lib/base-branding.ts apps/web/lib/tenant-theme.ts "apps/web/app/api/tenants/[id]/branding"`
Expected: no matches.

- [ ] **Step 5: Local smoke (no emulator needed now)**

Confirm the RootLayout no longer needs Firestore: with only Postgres + MinIO up (no Firebase emulator), `pnpm dev`, sign in, and load the dashboard — it should render without the ECONNREFUSED 127.0.0.1:8080 error that `tenant-theme` previously caused.

- [ ] **Step 6: Staging smoke (after deploy)**

On `dev.vibesboard.com`: switch into a team workspace → Settings/branding → load branding (GET 200) → save a primary color (PUT 200) → reload and confirm it persisted; verify the `tenant_branding` row on the VM via psql.

---

## Notes for the executor

- Postgres must be running for the `@vibesboard/tenants` tests.
- `getMigrateDb()` (BYPASSRLS) is correct here: branding reads/writes are identity-adjacent (the route already authorized via `requireTenantMember`/`requireTenantAdmin`, and tenant scoping is explicit by `tenant_id`).
- `resolveEffectiveBranding` and the color helpers are pure and unchanged — do not rewrite them.
- After this PR, the local app no longer needs the Firebase emulator for the dashboard to load.
