# Firestore→Postgres PR 1d: Admin Tenant Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Migrate the admin tenant-management surface off Firestore: `admin/tenants` (list + create), `admin/tenants/[id]` (detail/update/delete), `tenants/[id]/users/[userId]/role` (member role/remove). Completes the identity/tenancy phase and drops the residual `adminAuth.getUser`.

**Architecture:** New `@vibesboard/tenants/src/admin.ts` with DB helpers, `withTestDb`-tested; routes thin, pass `getMigrateDb()`. Postgres FK cascades replace Firestore `recursiveDelete` + `tenantIds`-array maintenance. Creator identity comes from the `users` table (no Firebase Auth).

**Tech Stack:** TS ESM, Drizzle, `node:test`, pnpm. Postgres running.

**Scope:** `packages/tenants/src/admin.ts` (+tests, +barrel), and the 3 routes above.

**Key simplifications vs Firestore:**
- DELETE = `delete from tenants where id` → FK `onDelete: cascade` removes `tenant_members`, `invitations`, `tenant_branding`; the slug is a tenant column (gone with the row). No recursiveDelete, no per-member `tenantIds` cleanup.
- Membership is the `tenant_members` join — `tenantIds` arrays do not exist.
- Creator/member identity from `users` (email/name) — no `adminAuth.getUser`.

---

## Task 1: Admin tenant + member helpers (TDD)

**Files:** Create `packages/tenants/src/admin.ts`; Test `packages/tenants/src/__tests__/admin.test.ts`; Modify `index.ts`.

- [ ] **Step 1: Write the failing test** `packages/tenants/src/__tests__/admin.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import {
  listTenants, createTenantAsAdmin, getTenantDetail, updateTenant,
  deleteTenant, setMemberRole, removeMember,
} from '../admin.ts'

async function seedUser(adminDb: any, email: string) {
  const id = uuidv7()
  await adminDb.insert(users).values({ id, email, name: email.split('@')[0] })
  return id
}

describe('createTenantAsAdmin', () => {
  test('creates an active non-personal tenant + TENANT_ADMIN member', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      assert.equal(r.ok, true)
      if (!r.ok) return
      assert.equal(r.tenant.status, 'active')
      assert.equal(r.tenant.isPersonal, false)
      const m = await adminDb.select().from(tenantMembers).where(eq(tenantMembers.tenantId, r.tenant.id))
      assert.equal(m.length, 1)
      assert.equal(m[0].role, 'TENANT_ADMIN')
    })
  })
  test('SLUG_TAKEN on duplicate slug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme2', slug: 'acme', createdBy: owner })
      assert.deepEqual(r, { ok: false, code: 'SLUG_TAKEN' })
    })
  })
})

describe('listTenants', () => {
  test('paginates, counts members, resolves creator identity', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'owner@acme.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'Acme', slug: 'acme', createdBy: owner })
      assert.equal(r.ok, true)
      const { tenants: list, total } = await listTenants(adminDb, { page: 1, limit: 10 })
      assert.equal(total, 1)
      assert.equal(list[0].user_count, 1)
      assert.equal(list[0].creator_email, 'owner@acme.com')
    })
  })
  test('filters by status', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (r.ok) await updateTenant(adminDb, r.tenant.id, { status: 'suspended' })
      const active = await listTenants(adminDb, { page: 1, limit: 10, status: 'active' })
      assert.equal(active.total, 0)
      const suspended = await listTenants(adminDb, { page: 1, limit: 10, status: 'suspended' })
      assert.equal(suspended.total, 1)
    })
  })
})

describe('getTenantDetail / updateTenant', () => {
  test('detail returns tenant + member count; null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      assert.equal(r.ok, true)
      if (!r.ok) return
      const detail = await getTenantDetail(adminDb, r.tenant.id)
      assert.equal(detail?.user_count, 1)
      assert.equal(detail?.tenant.slug, 'a')
      assert.equal(await getTenantDetail(adminDb, uuidv7()), null)
    })
  })
  test('updateTenant changes name/status; null when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      const updated = await updateTenant(adminDb, r.tenant.id, { name: 'A2', status: 'trial' })
      assert.equal(updated?.name, 'A2')
      assert.equal(updated?.status, 'trial')
      assert.equal(await updateTenant(adminDb, uuidv7(), { name: 'x' }), null)
    })
  })
})

describe('deleteTenant', () => {
  test('cascades members + invitations; returns true (false when missing)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId: r.tenant.id, email: 'x@a.com', token: uuidv7(),
        role: 'MEMBER', status: 'pending', expiresAt: new Date(Date.now() + 3600000), createdBy: owner,
      })
      assert.equal(await deleteTenant(adminDb, r.tenant.id), true)
      assert.equal((await adminDb.select().from(tenants).where(eq(tenants.id, r.tenant.id))).length, 0)
      assert.equal((await adminDb.select().from(tenantMembers).where(eq(tenantMembers.tenantId, r.tenant.id))).length, 0)
      assert.equal((await adminDb.select().from(invitations).where(eq(invitations.tenantId, r.tenant.id))).length, 0)
      assert.equal(await deleteTenant(adminDb, uuidv7()), false)
    })
  })
})

describe('setMemberRole / removeMember', () => {
  test('setMemberRole updates role; NOT_MEMBER when absent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      assert.deepEqual(await setMemberRole(adminDb, r.tenant.id, guest, 'MEMBER'), { ok: false, code: 'NOT_MEMBER' })
      await adminDb.insert(tenantMembers).values({ tenantId: r.tenant.id, userId: guest, role: 'MEMBER' })
      assert.deepEqual(await setMemberRole(adminDb, r.tenant.id, guest, 'TENANT_ADMIN'), { ok: true })
      const m = await adminDb.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, r.tenant.id), eq(tenantMembers.userId, guest)))
      assert.equal(m[0].role, 'TENANT_ADMIN')
    })
  })
  test('removeMember deletes the row; NOT_MEMBER when absent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const owner = await seedUser(adminDb, 'o@a.com')
      const guest = await seedUser(adminDb, 'g@a.com')
      const r = await createTenantAsAdmin(adminDb, { name: 'A', slug: 'a', createdBy: owner })
      if (!r.ok) return
      assert.deepEqual(await removeMember(adminDb, r.tenant.id, guest), { ok: false, code: 'NOT_MEMBER' })
      await adminDb.insert(tenantMembers).values({ tenantId: r.tenant.id, userId: guest, role: 'MEMBER' })
      assert.deepEqual(await removeMember(adminDb, r.tenant.id, guest), { ok: true })
      assert.equal((await adminDb.select().from(tenantMembers).where(and(eq(tenantMembers.tenantId, r.tenant.id), eq(tenantMembers.userId, guest)))).length, 0)
    })
  })
})
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter @vibesboard/tenants test` → FAIL (module not found).

- [ ] **Step 3: Implement** `packages/tenants/src/admin.ts`:

```ts
import { and, count, desc, eq, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenants, tenantMembers, users } from '@vibesboard/adapter-postgres/schema'
import { isUniqueViolation } from './db-utils.ts'

type Db = PostgresJsDatabase<typeof schema>

export type TenantStatus = 'active' | 'pending' | 'trial' | 'suspended'

export interface AdminTenant {
  id: string
  name: string
  slug: string
  status: string
  createdBy: string | null
  isPersonal: boolean
  createdAt: string
  updatedAt: string
}

function rowToAdminTenant(row: typeof tenants.$inferSelect): AdminTenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    createdBy: row.createdBy,
    isPersonal: row.isPersonal,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export type CreateTenantResult =
  | { ok: true; tenant: AdminTenant }
  | { ok: false; code: 'SLUG_TAKEN' }

/** Admin-created tenant: active, non-personal, creator is TENANT_ADMIN. */
export async function createTenantAsAdmin(
  db: Db,
  input: { name: string; slug: string; createdBy: string },
): Promise<CreateTenantResult> {
  const existing = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, input.slug)).limit(1)
  if (existing.length > 0) return { ok: false, code: 'SLUG_TAKEN' }

  const tenantId = uuidv7()
  try {
    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(tenants)
        .values({ id: tenantId, name: input.name, slug: input.slug, status: 'active', createdBy: input.createdBy, isPersonal: false })
        .returning()
      await tx.insert(tenantMembers).values({ tenantId, userId: input.createdBy, role: 'TENANT_ADMIN' })
      return inserted[0]
    })
    return { ok: true, tenant: rowToAdminTenant(row) }
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, code: 'SLUG_TAKEN' }
    throw err
  }
}

export interface AdminTenantListItem extends AdminTenant {
  user_count: number
  creator_email: string | null
  creator_name: string | null
}

/** Paginated tenant list with member counts + creator identity (from users). */
export async function listTenants(
  db: Db,
  opts: { page: number; limit: number; status?: string },
): Promise<{ tenants: AdminTenantListItem[]; total: number }> {
  const validStatus =
    opts.status && ['active', 'trial', 'suspended'].includes(opts.status) ? opts.status : undefined
  const where = validStatus ? eq(tenants.status, validStatus as TenantStatus) : undefined

  const totalRows = await db.select({ n: count() }).from(tenants).where(where)
  const total = Number(totalRows[0]?.n ?? 0)

  const memberCount = sql<number>`(select count(*) from ${tenantMembers} tm where tm.tenant_id = ${tenants.id})`
  const rows = await db
    .select({
      t: tenants,
      user_count: memberCount,
      creator_email: users.email,
      creator_name: users.name,
    })
    .from(tenants)
    .leftJoin(users, eq(users.id, tenants.createdBy))
    .where(where)
    .orderBy(desc(tenants.createdAt))
    .limit(opts.limit)
    .offset((opts.page - 1) * opts.limit)

  return {
    total,
    tenants: rows.map((r) => ({
      ...rowToAdminTenant(r.t),
      user_count: Number(r.user_count),
      creator_email: r.creator_email ?? null,
      creator_name: r.creator_name ?? null,
    })),
  }
}

/** Single tenant detail + member count, or null if missing. */
export async function getTenantDetail(
  db: Db,
  id: string,
): Promise<{ tenant: AdminTenant; user_count: number } | null> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
  if (rows.length === 0) return null
  const c = await db.select({ n: count() }).from(tenantMembers).where(eq(tenantMembers.tenantId, id))
  return { tenant: rowToAdminTenant(rows[0]), user_count: Number(c[0]?.n ?? 0) }
}

/** Update name/slug/status; returns the updated tenant or null if missing. */
export async function updateTenant(
  db: Db,
  id: string,
  fields: { name?: string; slug?: string; status?: string },
): Promise<AdminTenant | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (fields.name !== undefined) set.name = fields.name
  if (fields.slug !== undefined) set.slug = fields.slug
  if (fields.status !== undefined && ['active', 'trial', 'suspended'].includes(fields.status)) {
    set.status = fields.status
  }
  const updated = await db.update(tenants).set(set).where(eq(tenants.id, id)).returning()
  if (updated.length === 0) return null
  return rowToAdminTenant(updated[0])
}

/** Delete a tenant; FK cascades remove members, invitations, branding. */
export async function deleteTenant(db: Db, id: string): Promise<boolean> {
  const deleted = await db.delete(tenants).where(eq(tenants.id, id)).returning({ id: tenants.id })
  return deleted.length > 0
}

export type MemberMutationResult = { ok: true } | { ok: false; code: 'NOT_MEMBER' }

/** Update a member's role; NOT_MEMBER if not a member. */
export async function setMemberRole(
  db: Db,
  tenantId: string,
  userId: string,
  role: 'TENANT_ADMIN' | 'MEMBER',
): Promise<MemberMutationResult> {
  const updated = await db
    .update(tenantMembers)
    .set({ role })
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .returning({ userId: tenantMembers.userId })
  return updated.length > 0 ? { ok: true } : { ok: false, code: 'NOT_MEMBER' }
}

/** Remove a member; NOT_MEMBER if not a member. */
export async function removeMember(
  db: Db,
  tenantId: string,
  userId: string,
): Promise<MemberMutationResult> {
  const deleted = await db
    .delete(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.userId, userId)))
    .returning({ userId: tenantMembers.userId })
  return deleted.length > 0 ? { ok: true } : { ok: false, code: 'NOT_MEMBER' }
}
```

- [ ] **Step 4: Barrel** — append `export * from './admin.ts'` to `packages/tenants/src/index.ts`.

- [ ] **Step 5: Run tests + type-check** — all pass, clean.

- [ ] **Step 6: Commit** — `git add packages/tenants/src/admin.ts packages/tenants/src/index.ts packages/tenants/src/__tests__/admin.test.ts && git commit -m "feat(tenants): admin tenant + member management helpers on Postgres"`

---

## Task 2: Migrate `admin/tenants/route.ts` (GET list + POST create)

**Files:** Modify `apps/web/app/api/admin/tenants/route.ts`. Replace ENTIRELY:

```ts
import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { listTenants, createTenantAsAdmin } from '@vibesboard/tenants'
import { validateTenantSlug, validateTenantName, generateSlug } from '@/lib/validations'

export const runtime = 'nodejs'

/** GET /api/admin/tenants — list tenants (SUPER_ADMIN). */
export async function GET(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '10')
  const status = searchParams.get('status') ?? undefined

  const { tenants, total } = await listTenants(getMigrateDb(), { page, limit, status })

  return NextResponse.json({
    tenants,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  })
}

/** POST /api/admin/tenants — create tenant (SUPER_ADMIN). */
export async function POST(req: Request) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { name, slug: providedSlug, created_by } = body

  if (!name || !validateTenantName(name)) {
    return NextResponse.json({ error: 'Invalid tenant name' }, { status: 400 })
  }
  const slug = providedSlug || generateSlug(name)
  if (!validateTenantSlug(slug)) {
    return NextResponse.json({ error: 'Invalid tenant slug' }, { status: 400 })
  }

  const result = await createTenantAsAdmin(getMigrateDb(), {
    name,
    slug,
    createdBy: created_by || auth.user.id,
  })
  if (!result.ok) {
    return NextResponse.json({ error: 'Tenant slug already exists' }, { status: 409 })
  }

  return NextResponse.json({ tenant: result.tenant }, { status: 201 })
}
```

Verify: `pnpm --filter @vibesboard/web type-check` PASS; no `adminDb`/`adminAuth`/`Collections` in the file. Commit: `git add "apps/web/app/api/admin/tenants/route.ts" && git commit -m "feat(tenants): admin tenants list+create on Postgres (drops adminAuth)"`

---

## Task 3: Migrate `admin/tenants/[id]/route.ts` (GET/PUT/DELETE)

**Files:** Modify `apps/web/app/api/admin/tenants/[id]/route.ts`. Replace ENTIRELY:

```ts
import { NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getTenantDetail, updateTenant, deleteTenant, getTenantBranding } from '@vibesboard/tenants'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string }> }

/** GET /api/admin/tenants/[id] — detail (SUPER_ADMIN). */
export async function GET(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const db = getMigrateDb()
  const detail = await getTenantDetail(db, id)
  if (!detail) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  const branding = await getTenantBranding(db, id)

  return NextResponse.json({
    tenant: detail.tenant,
    branding,
    user_count: detail.user_count,
  })
}

/** PUT /api/admin/tenants/[id] — update (SUPER_ADMIN). */
export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const body = await req.json()
  const { name, slug, status } = body

  if (
    name === undefined &&
    slug === undefined &&
    !(status !== undefined && ['active', 'trial', 'suspended'].includes(status))
  ) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const tenant = await updateTenant(getMigrateDb(), id, { name, slug, status })
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  return NextResponse.json({ tenant })
}

/** DELETE /api/admin/tenants/[id] — hard delete (SUPER_ADMIN); FK cascades. */
export async function DELETE(req: Request, { params }: RouteParams) {
  const auth = await requireSuperAdmin()
  if (!auth.ok) return auth.response

  const { id } = await params
  const deleted = await deleteTenant(getMigrateDb(), id)
  if (!deleted) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
```

Verify: `pnpm --filter @vibesboard/web type-check` PASS; no Firestore in the file. Commit: `git add "apps/web/app/api/admin/tenants/[id]/route.ts" && git commit -m "feat(tenants): admin tenant detail/update/delete on Postgres (FK cascade)"`

---

## Task 4: Migrate `tenants/[id]/users/[userId]/role/route.ts` (PUT/DELETE)

**Files:** Modify `apps/web/app/api/tenants/[id]/users/[userId]/role/route.ts`. Replace ENTIRELY:

```ts
import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { setMemberRole, removeMember } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'

export const runtime = 'nodejs'

type RouteParams = { params: Promise<{ id: string; userId: string }> }

/** PUT /api/tenants/[id]/users/[userId]/role — set member role. */
export async function PUT(req: Request, { params }: RouteParams) {
  const { id: tenantId, userId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'
  if (auth.user.id === userId && !isSuperAdminUser) {
    return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 })
  }

  const body = await req.json()
  const { role } = body
  if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' }, { status: 400 })
  }

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (tenant.isPersonal) {
    return NextResponse.json({ error: 'Personal workspaces cannot manage team roles' }, { status: 403 })
  }
  if (!isSuperAdminUser) {
    const teamEnabled = await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')
    if (!teamEnabled) {
      return NextResponse.json({ error: 'Team collaboration is disabled for this workspace' }, { status: 403 })
    }
  }

  const result = await setMemberRole(getMigrateDb(), tenantId, userId, role)
  if (!result.ok) {
    return NextResponse.json({ error: 'User is not a member of this tenant' }, { status: 404 })
  }
  return NextResponse.json({ success: true, user: { userId, tenantId, role } })
}

/** DELETE /api/tenants/[id]/users/[userId]/role — remove member. */
export async function DELETE(req: Request, { params }: RouteParams) {
  const { id: tenantId, userId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const isSuperAdminUser = auth.role === 'SUPER_ADMIN'
  if (auth.user.id === userId) {
    return NextResponse.json({ error: 'Cannot remove yourself from tenant' }, { status: 400 })
  }

  const tenant = await getTenantById(tenantId)
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }
  if (tenant.isPersonal) {
    return NextResponse.json({ error: 'Personal workspaces cannot manage team membership' }, { status: 403 })
  }
  if (!isSuperAdminUser) {
    const teamEnabled = await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')
    if (!teamEnabled) {
      return NextResponse.json({ error: 'Team collaboration is disabled for this workspace' }, { status: 403 })
    }
  }

  const result = await removeMember(getMigrateDb(), tenantId, userId)
  if (!result.ok) {
    return NextResponse.json({ error: 'User is not a member of this tenant' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}
```

Verify: `pnpm --filter @vibesboard/web type-check` PASS; no Firestore in the file. Commit: `git add "apps/web/app/api/tenants/[id]/users/[userId]/role/route.ts" && git commit -m "feat(tenants): member role/remove on Postgres"`

---

## Task 5: Verify

- [ ] `pnpm --filter @vibesboard/tenants test` → all pass.
- [ ] `pnpm type-check` → clean. `pnpm lint` → 0 errors.
- [ ] `grep -rn "adminDb\|adminAuth\|firebase-admin/firestore" "apps/web/app/api/admin/tenants" "apps/web/app/api/tenants/[id]/users"` → none.
- [ ] **Staging e2e (SUPER_ADMIN test user):** `GET /api/admin/tenants` (list, pagination, creator_email populated) → `POST` create a tenant (201) → `GET /api/admin/tenants/[id]` (detail) → `PUT` update status to suspended → list filtered by status=suspended shows it → seed a 2nd user as a member, `PUT .../users/[uid]/role` to TENANT_ADMIN (200), then `DELETE` (200) → `DELETE /api/admin/tenants/[id]` (200) and confirm cascade on the VM (tenant + members + invitations gone).

---

## Notes
- `getMigrateDb()` (BYPASSRLS) is correct: `requireSuperAdmin`/`requireTenantAdmin` authorize, scoping is explicit.
- DELETE relies on schema FK `onDelete: cascade` (tenant_members, invitations, tenant_branding all reference tenants with cascade) — verify those cascades exist; they do per the schema.
- `createTenantAsAdmin` does not write a branding row (matches PR 1a/1b: no row = inherits base). The old Firestore admin-create wrote a default branding doc; omitting it is the intended new behavior.
- `resolveUserIdentity`/first-member fallback simplified to a `createdBy`→`users` left join. If `created_by` is null/unknown, `creator_email` is null (acceptable; admin-created tenants always set it).
