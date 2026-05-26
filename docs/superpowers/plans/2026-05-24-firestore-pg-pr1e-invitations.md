# Firestore→Postgres PR 1e: Invitation CRUD — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Migrate the invitation create/list/preview/cancel routes off Firestore (PR 1a did `accept`), and the trivial tenant-read in `tenants/[id]/features`. Closes the identity data migration.

**Architecture:** Extend `@vibesboard/tenants/src/invitations.ts` with helpers (`withTestDb`-tested); routes thin, pass `getMigrateDb()`. The `invitations` table exists (PR 1a used it for accept).

**Tech Stack:** TS ESM, Drizzle, `node:test`, pnpm. Postgres running.

**Scope:** `packages/tenants/src/invitations.ts` (+helpers, +tests); `apps/web/app/api/tenants/[id]/invitations/route.ts` (GET/POST); `apps/web/app/api/invitations/[token]/route.ts` (GET/DELETE); `apps/web/app/api/tenants/[id]/features/route.ts` (tenant-read swap).

**Out of scope (PR 1f — dead-code removal):** `admin/feature-flags` (+`[id]`) routes + `app/admin/feature-flags` page + dialogs — vestigial now that `policy/features` is an all-enabled shim; remove rather than migrate.

**Schema (`@vibesboard/adapter-postgres/schema`):** `invitations` { id (uuid PK), tenantId, email, token (unique), role (TENANT_ADMIN|MEMBER), status (pending|accepted|expired), expiresAt, acceptedAt, createdBy, createdAt }; `tenantMembers`, `users`, `tenants`.

---

## Task 1: Invitation CRUD helpers (TDD)

**Files:** Modify `packages/tenants/src/invitations.ts`; add tests to `packages/tenants/src/__tests__/invitations.test.ts`.

Add these exports (append to `invitations.ts`):

```ts
import { uuidv7 } from 'uuidv7'
import { sql } from 'drizzle-orm'
// (existing imports already include and, eq, schema, tenantMembers, invitations)
import { tenants, users } from '@vibesboard/adapter-postgres/schema'

export interface CreateInvitationInput {
  tenantId: string
  email: string
  role: 'TENANT_ADMIN' | 'MEMBER'
  token: string
  createdBy: string
  expiresAt: Date
}

export interface InvitationRow {
  id: string
  email: string
  role: string
  status: string
  createdAt: string
  expiresAt: string
}

export type CreateInvitationResult =
  | { ok: true; invitation: InvitationRow }
  | { ok: false; code: 'ALREADY_MEMBER' | 'PENDING_EXISTS' }

/** Create a pending invitation (email normalized lowercase). Rejects if the
 *  email already belongs to a member or a pending invite exists. */
export async function createInvitation(
  db: Db,
  input: CreateInvitationInput,
): Promise<CreateInvitationResult> {
  const email = input.email.trim().toLowerCase()

  const member = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(and(eq(tenantMembers.tenantId, input.tenantId), sql`lower(${users.email}) = ${email}`))
    .limit(1)
  if (member.length > 0) return { ok: false, code: 'ALREADY_MEMBER' }

  const pending = await db
    .select({ id: invitations.id })
    .from(invitations)
    .where(and(eq(invitations.tenantId, input.tenantId), eq(invitations.email, email), eq(invitations.status, 'pending')))
    .limit(1)
  if (pending.length > 0) return { ok: false, code: 'PENDING_EXISTS' }

  const id = uuidv7()
  const rows = await db
    .insert(invitations)
    .values({
      id,
      tenantId: input.tenantId,
      email,
      token: input.token,
      role: input.role,
      status: 'pending',
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    })
    .returning()
  const r = rows[0]
  return {
    ok: true,
    invitation: {
      id: r.id,
      email: r.email,
      role: r.role,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
    },
  }
}

/** List a tenant's invitations, newest first. */
export async function listInvitations(db: Db, tenantId: string): Promise<InvitationRow[]> {
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.tenantId, tenantId))
    .orderBy(desc(invitations.createdAt))
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
  }))
}

export interface InvitationPreview {
  id: string
  tenant_id: string
  tenant_name: string | null
  email: string
  role: string
  status: string
  created_at: string
  expires_at: string
  accepted_at: string | null
  invited_by_email: string | null
}

/** Public preview by token; reconciles expired status. Returns null if missing.
 *  `email` is returned raw — the route masks it. */
export async function getInvitationByToken(db: Db, token: string): Promise<InvitationPreview | null> {
  const rows = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1)
  if (rows.length === 0) return null
  let inv = rows[0]

  // Past expiry + still pending → mark expired.
  if (inv.expiresAt.getTime() < Date.now() && inv.status === 'pending') {
    const updated = await db
      .update(invitations)
      .set({ status: 'expired' })
      .where(eq(invitations.id, inv.id))
      .returning()
    inv = updated[0]
  }

  const tenantRows = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, inv.tenantId)).limit(1)
  const inviterRows = inv.createdBy
    ? await db.select({ email: users.email }).from(users).where(eq(users.id, inv.createdBy)).limit(1)
    : []

  return {
    id: inv.id,
    tenant_id: inv.tenantId,
    tenant_name: tenantRows[0]?.name ?? null,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    created_at: inv.createdAt.toISOString(),
    expires_at: inv.expiresAt.toISOString(),
    accepted_at: inv.acceptedAt ? inv.acceptedAt.toISOString() : null,
    invited_by_email: inviterRows[0]?.email ?? null,
  }
}

export type CancelInvitationResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_ACCEPTED'; tenantId?: string }

/** Look up an invitation's tenant for authorization (by id). */
export async function getInvitationTenant(db: Db, id: string): Promise<{ tenantId: string; status: string } | null> {
  const rows = await db.select({ tenantId: invitations.tenantId, status: invitations.status }).from(invitations).where(eq(invitations.id, id)).limit(1)
  return rows.length > 0 ? { tenantId: rows[0].tenantId, status: rows[0].status } : null
}

/** Cancel (expire) an invitation by id. Rejects accepted invitations. */
export async function cancelInvitation(db: Db, id: string): Promise<CancelInvitationResult> {
  const existing = await getInvitationTenant(db, id)
  if (!existing) return { ok: false, code: 'NOT_FOUND' }
  if (existing.status === 'accepted') return { ok: false, code: 'ALREADY_ACCEPTED', tenantId: existing.tenantId }
  await db.update(invitations).set({ status: 'expired', expiresAt: new Date() }).where(eq(invitations.id, id))
  return { ok: true }
}
```

Ensure `invitations.ts` imports `desc`, `sql`, `uuidv7`, and `tenants`, `users` (add to existing imports as needed).

- [ ] **Step 1: Write failing tests** — append to `invitations.test.ts` (import the new fns + `tenants`, `users` already imported there):

```ts
describe('createInvitation / listInvitations', () => {
  test('creates a pending invitation and lists it', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const r = await createInvitation(adminDb, {
        tenantId, email: 'New@Acme.com', role: 'MEMBER', token: 'tok-1', createdBy: ownerId,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600000),
      })
      assert.equal(r.ok, true)
      if (!r.ok) return
      assert.equal(r.invitation.email, 'new@acme.com') // normalized
      const list = await listInvitations(adminDb, tenantId)
      assert.equal(list.length, 1)
      assert.equal(list[0].status, 'pending')
    })
  })
  test('ALREADY_MEMBER when email is an existing member', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      // seedTenantAndUser does NOT add a membership — insert one so owner is a member.
      await adminDb.insert(tenantMembers).values({ tenantId, userId: ownerId, role: 'TENANT_ADMIN' })
      const r = await createInvitation(adminDb, {
        tenantId, email: 'owner@acme.com', role: 'MEMBER', token: 'tok-2', createdBy: ownerId,
        expiresAt: new Date(Date.now() + 3600000),
      })
      assert.deepEqual(r, { ok: false, code: 'ALREADY_MEMBER' })
    })
  })
  test('PENDING_EXISTS on duplicate pending invite', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, { tenantId, email: 'dup@x.com', role: 'MEMBER', token: 't1', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      const r = await createInvitation(adminDb, { tenantId, email: 'dup@x.com', role: 'MEMBER', token: 't2', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      assert.deepEqual(r, { ok: false, code: 'PENDING_EXISTS' })
    })
  })
})

describe('getInvitationByToken / cancelInvitation', () => {
  test('preview returns tenant + inviter; reconciles expiry', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, { tenantId, email: 'p@x.com', role: 'MEMBER', token: 'prev-tok', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      const preview = await getInvitationByToken(adminDb, 'prev-tok')
      assert.equal(preview?.tenant_name, 'Acme')
      assert.equal(preview?.invited_by_email, 'owner@acme.com')
      assert.equal(preview?.status, 'pending')
      assert.equal(await getInvitationByToken(adminDb, 'missing'), null)
    })
  })
  test('past-expiry pending preview flips to expired', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      await createInvitation(adminDb, { tenantId, email: 'e@x.com', role: 'MEMBER', token: 'exp-tok', createdBy: ownerId, expiresAt: new Date(Date.now() - 3600000) })
      const preview = await getInvitationByToken(adminDb, 'exp-tok')
      assert.equal(preview?.status, 'expired')
    })
  })
  test('cancelInvitation expires a pending invite; NOT_FOUND when missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, tenantId } = await seedTenantAndUser(adminDb)
      const r = await createInvitation(adminDb, { tenantId, email: 'c@x.com', role: 'MEMBER', token: 'c-tok', createdBy: ownerId, expiresAt: new Date(Date.now() + 3600000) })
      if (!r.ok) return
      assert.deepEqual(await cancelInvitation(adminDb, r.invitation.id), { ok: true })
      const preview = await getInvitationByToken(adminDb, 'c-tok')
      assert.equal(preview?.status, 'expired')
      assert.deepEqual(await cancelInvitation(adminDb, uuidv7()), { ok: false, code: 'NOT_FOUND' })
    })
  })
})
```
(The existing `invitations.test.ts` already has a `seedTenantAndUser(adminDb)` helper returning `{ ownerId, inviteeId, tenantId }` with tenant name `Acme` and owner `owner@acme.com`. Import the new functions + `uuidv7` if not already imported.)

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @vibesboard/tenants test` → new tests FAIL (exports missing).
- [ ] **Step 3: Implement** the helpers above in `invitations.ts`.
- [ ] **Step 4: Barrel** — already `export * from './invitations.ts'` (no change).
- [ ] **Step 5: Run tests + type-check** — all pass, clean.
- [ ] **Step 6: Commit** — `git add packages/tenants/src/invitations.ts packages/tenants/src/__tests__/invitations.test.ts && git commit -m "feat(tenants): invitation create/list/preview/cancel helpers on Postgres"`

---

## Task 2: Migrate `tenants/[id]/invitations/route.ts` (GET/POST)

Thin the route: auth + personal/feature checks via `getTenantById`, generate token + expiry, call `createInvitation`/`listInvitations`, keep the email-send (`after(sendInvitationEmail(...))`) and invite-URL building.

```ts
import { after, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { createInvitation, listInvitations } from '@vibesboard/tenants'
import { getTenantById } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { validateEmail } from '@/lib/validations'
import { randomBytes } from 'crypto'
import { sendInvitationEmail } from '@/lib/email'

export const runtime = 'nodejs'
type RouteParams = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const tenant = await getTenantById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.isPersonal) return NextResponse.json({ invitations: [] })
  if (auth.role !== 'SUPER_ADMIN') {
    if (!(await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')))
      return NextResponse.json({ error: 'Team collaboration is disabled for this workspace' }, { status: 403 })
  }

  const rows = await listInvitations(getMigrateDb(), tenantId)
  return NextResponse.json({
    invitations: rows.map((r) => ({
      id: r.id, email: r.email, role: r.role, status: r.status,
      created_at: r.createdAt, expires_at: r.expiresAt,
    })),
  })
}

export async function POST(req: Request, { params }: RouteParams) {
  const { id: tenantId } = await params
  const auth = await requireTenantAdmin(tenantId)
  if (!auth.ok) return auth.response

  const body = await req.json()
  const { email, role } = body
  if (!email || !validateEmail(email)) return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  if (!role || !['TENANT_ADMIN', 'MEMBER'].includes(role)) return NextResponse.json({ error: 'Invalid role. Must be TENANT_ADMIN or MEMBER' }, { status: 400 })

  const tenant = await getTenantById(tenantId)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.isPersonal) return NextResponse.json({ error: 'Personal workspaces cannot invite members' }, { status: 403 })
  if (auth.role !== 'SUPER_ADMIN') {
    if (!(await isFeatureEnabled(tenantId, 'TEAM_COLLABORATION')))
      return NextResponse.json({ error: 'Team collaboration is disabled for this workspace' }, { status: 403 })
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  const result = await createInvitation(getMigrateDb(), {
    tenantId, email, role, token, createdBy: auth.user.id, expiresAt,
  })
  if (!result.ok) {
    const msg = result.code === 'ALREADY_MEMBER' ? 'User is already a member of this tenant' : 'Invitation already sent to this email'
    return NextResponse.json({ error: msg }, { status: 409 })
  }

  const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const forwardedHost = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))?.split(',')[0]?.trim()
  const origin = forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}` : process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
  const inviteUrl = `${origin}/invite/${token}`

  after(
    sendInvitationEmail({
      to: result.invitation.email,
      inviteUrl,
      tenantName: tenant.name || 'your team',
      inviterName: auth.user.name || auth.user.email || 'A team member',
      role,
    }),
  )

  return NextResponse.json({ invitation: { ...result.invitation, tenantId, token }, inviteUrl }, { status: 201 })
}
```

Verify type-check + no Firestore. Commit: `feat(tenants): invitation create/list route on Postgres`.

---

## Task 3: Migrate `invitations/[token]/route.ts` (GET preview + DELETE cancel)

```ts
import { NextResponse } from 'next/server'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { getInvitationByToken, getInvitationTenant, cancelInvitation } from '@vibesboard/tenants'
import { maskEmail } from '@/lib/email'

export const runtime = 'nodejs'
type RouteParams = { params: Promise<{ token: string }> }

/** GET /api/invitations/[token] — public preview. */
export async function GET(req: Request, { params }: RouteParams) {
  const { token } = await params
  const preview = await getInvitationByToken(getMigrateDb(), token)
  if (!preview) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  return NextResponse.json({
    invitation: { ...preview, email: maskEmail(preview.email) },
  })
}

/** DELETE /api/invitations/[token] — cancel (param is the invitation id). */
export async function DELETE(req: Request, { params }: RouteParams) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const { token: invitationId } = await params
  const db = getMigrateDb()

  const found = await getInvitationTenant(db, invitationId)
  if (!found) return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })

  const adminCheck = await requireTenantAdmin(found.tenantId)
  if (!adminCheck.ok) return adminCheck.response

  const result = await cancelInvitation(db, invitationId)
  if (!result.ok) {
    if (result.code === 'ALREADY_ACCEPTED')
      return NextResponse.json({ error: 'Cannot cancel an accepted invitation' }, { status: 400 })
    return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
  }
  return new NextResponse(null, { status: 204 })
}
```

Note the `email` field in the preview is masked here (helper returns raw). Verify type-check + no Firestore. Commit: `feat(tenants): invitation preview/cancel route on Postgres`.

---

## Task 4: Migrate `tenants/[id]/features/route.ts` (tenant-read swap)

The GET already uses `getTenantFeatures` (shim) and PUT uses `toggleFeature` (shim no-op); only the PUT's tenant-existence check reads Firestore. Replace that read with `getTenantById`:

- Remove `adminDb`/`Collections` imports.
- In PUT, replace the `adminDb.collection(Collections.tenants).doc(tenantId).get()` existence check with:
```ts
import { getTenantById } from '@/lib/tenant-context'
// ...
const tenant = await getTenantById(tenantId)
if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
```
Keep the rest (validation, `toggleFeature`, responses) unchanged.

Verify type-check + no Firestore in the file. Commit: `feat(tenants): tenant features route tenant-check on Postgres`.

---

## Task 5: Verify
- [ ] `pnpm --filter @vibesboard/tenants test` → all pass.
- [ ] `pnpm type-check` clean; `pnpm lint` 0 errors.
- [ ] `grep -rn "adminDb\|firebase-admin/firestore" "apps/web/app/api/tenants/[id]/invitations" "apps/web/app/api/invitations/[token]" "apps/web/app/api/tenants/[id]/features"` → none.
- [ ] **Staging e2e:** as a team admin — `POST /api/tenants/[id]/invitations` (201, returns inviteUrl) → `GET` list shows it (pending) → `GET /api/invitations/[token]` preview (masked email, tenant_name, inviter) → `DELETE /api/invitations/[invitationId]` (204) → list shows expired. Dup email → 409; existing member email → 409. Verify rows on the VM.

## Notes
- `getMigrateDb()` (BYPASSRLS) — routes authorize via `requireTenantAdmin`; scoping explicit by tenantId.
- Email stored normalized lowercase; member/pending checks compare lowercase.
- The DELETE param is the invitation **id** (uuid) from the list; preview GET param is the **token**.
