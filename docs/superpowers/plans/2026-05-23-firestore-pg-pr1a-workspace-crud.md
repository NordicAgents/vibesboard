# Firestore→Postgres PR 1a: Workspace Creation & Invitation Acceptance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate team-workspace creation, invitation acceptance, and remove the dead Firebase-Auth user trigger — moving these off Firestore (`adminDb`) onto Postgres.

**Architecture:** Per the migration spec (`docs/superpowers/specs/2026-05-23-firestore-to-postgres-migration-design.md`) and #170's established pattern: DB logic is extracted into a new `@vibesboard/tenants` package (Postgres-tested with `withTestDb`); route handlers stay thin (auth + validation + call helper + map response) and are verified live on staging. Identity-adjacent writes use the BYPASSRLS migrate client because workspace creation/invite acceptance happen before any tenant GUC context exists. IDs are `uuidv7()`.

**Tech Stack:** TypeScript (ESM, `--experimental-strip-types`), Drizzle ORM (postgres-js), pgvector Postgres, `node:test` + `node:assert/strict`, pnpm workspaces.

**Prerequisites:** Local Postgres running — `pnpm db:up` (and `pnpm db:migrate` if the schema isn't current). The new package's tests require it.

**Scope (this PR):**
- `apps/web/app/api/tenants/create-team/route.ts` → Postgres
- `apps/web/app/api/invitations/[token]/accept/route.ts` → Postgres
- Delete `apps/functions/src/on-user-created.ts` (dead Firebase-Auth trigger)

**Out of scope (separate plans):** `admin/tenants` (+`[id]`), `tenants/[id]/users/[userId]/role`, and all of PR 1b (branding/feature-toggles/theme).

---

## File Structure

**New package `packages/tenants`:**
- `packages/tenants/package.json` — workspace package manifest (mirrors `adapter-better-auth`)
- `packages/tenants/tsconfig.json` — extends base config
- `packages/tenants/src/index.ts` — barrel re-exporting the helpers
- `packages/tenants/src/workspace.ts` — `createTeamWorkspace`, `MAX_TEAM_WORKSPACES`
- `packages/tenants/src/invitations.ts` — `acceptInvitation`
- `packages/tenants/src/__tests__/workspace.test.ts`
- `packages/tenants/src/__tests__/invitations.test.ts`

**Modified:**
- `apps/web/app/api/tenants/create-team/route.ts` — thin, calls `createTeamWorkspace`
- `apps/web/app/api/invitations/[token]/accept/route.ts` — thin, calls `acceptInvitation`
- `apps/web/package.json` — add `@vibesboard/tenants` dependency
- `apps/functions/src/index.ts` — drop the `onUserCreated` export

**Deleted:**
- `apps/functions/src/on-user-created.ts`

**Shared types used (already exist in `@vibesboard/adapter-postgres/schema`):**
- `tenants` — `{ id, name, slug, status, planId, createdBy, isPersonal, googlePlaceId, branding, createdAt, updatedAt }`
- `tenantMembers` — `{ tenantId, userId, role, joinedAt }`, PK `(tenantId, userId)`
- `invitations` — `{ id, tenantId, email, token, role, status, expiresAt, acceptedAt, createdBy, createdAt }`

---

## Task 1: Scaffold the `@vibesboard/tenants` package

**Files:**
- Create: `packages/tenants/package.json`
- Create: `packages/tenants/tsconfig.json`
- Create: `packages/tenants/src/index.ts`

- [ ] **Step 1: Create `packages/tenants/package.json`**

```json
{
  "name": "@vibesboard/tenants",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "node --experimental-strip-types --test 'src/__tests__/**/*.test.ts'"
  },
  "dependencies": {
    "@vibesboard/adapter-postgres": "workspace:*",
    "drizzle-orm": "^0.45.2",
    "uuidv7": "^1.0.2"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^5.9.3"
  }
}
```

- [ ] **Step 2: Create `packages/tenants/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create a placeholder barrel `packages/tenants/src/index.ts`**

```ts
// @vibesboard/tenants — workspace & membership operations on Postgres.
export {}
```

- [ ] **Step 4: Link the new workspace package**

Run: `pnpm install`
Expected: completes; `@vibesboard/tenants` is linked into the workspace (no errors about an unknown package).

- [ ] **Step 5: Commit**

```bash
git add packages/tenants/package.json packages/tenants/tsconfig.json packages/tenants/src/index.ts pnpm-lock.yaml
git commit -m "feat(tenants): scaffold @vibesboard/tenants package"
```

---

## Task 2: `createTeamWorkspace` helper (TDD)

**Files:**
- Create: `packages/tenants/src/workspace.ts`
- Test: `packages/tenants/src/__tests__/workspace.test.ts`

A team workspace is a non-personal tenant whose creator becomes `TENANT_ADMIN`. Replaces the Firestore batch (tenant + `tenant_slugs` lock + branding subdoc + member + `user.tenantIds`). In Postgres: slug uniqueness is the `tenants.slug` unique constraint (pre-checked for a friendly 409), membership is the `tenant_members` row, the `tenantIds` array is gone, and default branding is omitted (a tenant with no branding row inherits platform base branding — branding is PR 1b).

- [ ] **Step 1: Write the failing test**

`packages/tenants/src/__tests__/workspace.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'
import { createTeamWorkspace, MAX_TEAM_WORKSPACES } from '../workspace.ts'

describe('createTeamWorkspace', () => {
  test('creates a non-personal tenant + TENANT_ADMIN membership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })

      const result = await createTeamWorkspace(adminDb, {
        userId,
        name: 'Acme Team',
        slug: 'acme-team',
      })

      assert.equal(result.ok, true)
      if (!result.ok) return
      assert.equal(result.tenant.slug, 'acme-team')
      assert.equal(result.tenant.isPersonal, false)
      assert.equal(result.tenant.status, 'pending')
      assert.equal(typeof result.tenant.createdAt, 'string')

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, result.tenant.id)))
      assert.equal(ms.length, 1)
      assert.equal(ms[0].role, 'TENANT_ADMIN')
    })
  })

  test('returns SLUG_TAKEN when the slug already exists', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })
      await adminDb.insert(tenants).values({
        id: uuidv7(), name: 'Existing', slug: 'taken', createdBy: userId, isPersonal: false,
      })

      const result = await createTeamWorkspace(adminDb, { userId, name: 'New', slug: 'taken' })

      assert.deepEqual(result, { ok: false, code: 'SLUG_TAKEN' })
    })
  })

  test('returns LIMIT after MAX_TEAM_WORKSPACES non-personal tenants', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })
      for (let i = 0; i < MAX_TEAM_WORKSPACES; i++) {
        const tid = uuidv7()
        await adminDb.insert(tenants).values({
          id: tid, name: `T${i}`, slug: `team-${i}`, createdBy: userId, isPersonal: false,
        })
        await adminDb.insert(tenantMembers).values({ tenantId: tid, userId, role: 'TENANT_ADMIN' })
      }

      const result = await createTeamWorkspace(adminDb, { userId, name: 'One Too Many', slug: 'overflow' })

      assert.deepEqual(result, { ok: false, code: 'LIMIT' })
    })
  })

  test('personal tenants do not count toward the team limit', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })
      const personal = uuidv7()
      await adminDb.insert(tenants).values({
        id: personal, name: 'Personal', slug: 'owner', createdBy: userId, isPersonal: true,
      })
      await adminDb.insert(tenantMembers).values({ tenantId: personal, userId, role: 'TENANT_ADMIN' })

      const result = await createTeamWorkspace(adminDb, { userId, name: 'First Team', slug: 'first-team' })

      assert.equal(result.ok, true)
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @vibesboard/tenants test`
Expected: FAIL — `Cannot find module '../workspace.ts'` (or "createTeamWorkspace is not exported").

- [ ] **Step 3: Write the implementation**

`packages/tenants/src/workspace.ts`:

```ts
import { uuidv7 } from 'uuidv7'
import { and, eq, count } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

/** Maximum non-personal workspaces a user can create. */
export const MAX_TEAM_WORKSPACES = 5

export interface CreateTeamWorkspaceInput {
  userId: string
  name: string
  slug: string
}

export interface CreatedTenant {
  id: string
  name: string
  slug: string
  status: string
  createdBy: string
  isPersonal: boolean
  createdAt: string
  updatedAt: string
}

export type CreateTeamWorkspaceResult =
  | { ok: true; tenant: CreatedTenant }
  | { ok: false; code: 'LIMIT' | 'SLUG_TAKEN' }

/**
 * Create a team (non-personal) workspace and make the creator TENANT_ADMIN.
 * Identity-adjacent: callers pass a BYPASSRLS migrate client because there is
 * no tenant GUC context at workspace-creation time.
 */
export async function createTeamWorkspace(
  db: Db,
  input: CreateTeamWorkspaceInput,
): Promise<CreateTeamWorkspaceResult> {
  // Rate limit: count this user's non-personal memberships.
  const [{ n }] = await db
    .select({ n: count() })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenantMembers.tenantId, tenants.id))
    .where(and(eq(tenantMembers.userId, input.userId), eq(tenants.isPersonal, false)))
  if (Number(n) >= MAX_TEAM_WORKSPACES) {
    return { ok: false, code: 'LIMIT' }
  }

  // Friendly pre-check for slug collision (the unique constraint is the
  // ultimate guard, but we want a 409 rather than a thrown constraint error).
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, input.slug))
    .limit(1)
  if (existing.length > 0) {
    return { ok: false, code: 'SLUG_TAKEN' }
  }

  const tenantId = uuidv7()
  const row = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(tenants)
      .values({
        id: tenantId,
        name: input.name,
        slug: input.slug,
        status: 'pending',
        createdBy: input.userId,
        isPersonal: false,
      })
      .returning()
    await tx.insert(tenantMembers).values({
      tenantId,
      userId: input.userId,
      role: 'TENANT_ADMIN',
    })
    return inserted[0]
  })

  return {
    ok: true,
    tenant: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      createdBy: row.createdBy as string,
      isPersonal: row.isPersonal,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  }
}
```

- [ ] **Step 4: Export from the barrel**

Replace `packages/tenants/src/index.ts`:

```ts
// @vibesboard/tenants — workspace & membership operations on Postgres.
export * from './workspace.ts'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @vibesboard/tenants test`
Expected: PASS — 4 tests in `workspace.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/tenants/src/workspace.ts packages/tenants/src/index.ts packages/tenants/src/__tests__/workspace.test.ts
git commit -m "feat(tenants): createTeamWorkspace helper on Postgres"
```

---

## Task 3: Wire the create-team route to the helper

**Files:**
- Modify: `apps/web/package.json` (add dependency)
- Modify: `apps/web/app/api/tenants/create-team/route.ts`

- [ ] **Step 1: Add the workspace package as a dependency of the web app**

In `apps/web/package.json`, add to `"dependencies"` (keep alphabetical with the other `@vibesboard/*` entries):

```json
    "@vibesboard/tenants": "workspace:*",
```

- [ ] **Step 2: Install to link the dependency**

Run: `pnpm install`
Expected: completes; `@vibesboard/tenants` resolves inside `apps/web`.

- [ ] **Step 3: Replace the route body**

Replace the entire contents of `apps/web/app/api/tenants/create-team/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { createTeamWorkspace, MAX_TEAM_WORKSPACES } from '@vibesboard/tenants'
import {
  validateTenantSlug,
  validateTenantName,
  generateSlug,
} from '@/lib/validations'

export const runtime = 'nodejs'

/**
 * POST /api/tenants/create-team
 * Create a new team workspace (any authenticated user).
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const body = await request.json()
  const { name, slug: providedSlug } = body as { name: string; slug?: string }

  if (!name || !validateTenantName(name)) {
    return NextResponse.json(
      {
        error:
          'Invalid workspace name. Use 2-100 characters with letters, numbers, spaces, hyphens, or underscores.',
      },
      { status: 400 },
    )
  }

  const slug = providedSlug || generateSlug(name)
  if (!validateTenantSlug(slug)) {
    return NextResponse.json({ error: 'Invalid workspace slug' }, { status: 400 })
  }

  const result = await createTeamWorkspace(getMigrateDb(), {
    userId: auth.user.id,
    name,
    slug,
  })

  if (!result.ok) {
    if (result.code === 'LIMIT') {
      return NextResponse.json(
        { error: `You can create a maximum of ${MAX_TEAM_WORKSPACES} team workspaces` },
        { status: 429 },
      )
    }
    return NextResponse.json(
      { error: 'Workspace slug already exists. Please choose a different name.' },
      { status: 409 },
    )
  }

  return NextResponse.json({ tenant: result.tenant }, { status: 201 })
}
```

- [ ] **Step 4: Type-check the web app**

Run: `pnpm --filter @vibesboard/web type-check`
Expected: PASS — no errors. (Confirms `getMigrateDb` and `@vibesboard/tenants` resolve and the route compiles.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/app/api/tenants/create-team/route.ts pnpm-lock.yaml
git commit -m "feat(tenants): create-team route uses Postgres workspace helper"
```

---

## Task 4: `acceptInvitation` helper (TDD)

**Files:**
- Create: `packages/tenants/src/invitations.ts`
- Test: `packages/tenants/src/__tests__/invitations.test.ts`

Replaces the Firestore batch (member set + invitation update + `user.tenantIds`). In Postgres: insert the `tenant_members` row, mark the invitation `accepted`. The `tenantIds` array is gone; setting the active-tenant cookie stays in the route.

- [ ] **Step 1: Write the failing test**

`packages/tenants/src/__tests__/invitations.test.ts`:

```ts
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'
import { acceptInvitation } from '../invitations.ts'

const HOUR = 60 * 60 * 1000

async function seedTenantAndUser(adminDb: any) {
  const ownerId = uuidv7()
  const inviteeId = uuidv7()
  const tenantId = uuidv7()
  await adminDb.insert(users).values([
    { id: ownerId, email: 'owner@acme.com', name: 'Owner' },
    { id: inviteeId, email: 'guest@acme.com', name: 'Guest' },
  ])
  await adminDb.insert(tenants).values({
    id: tenantId, name: 'Acme', slug: 'acme', createdBy: ownerId, isPersonal: false,
  })
  return { ownerId, inviteeId, tenantId }
}

describe('acceptInvitation', () => {
  test('adds the member with the invited role and marks the invite accepted', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'pending', expiresAt: new Date(Date.now() + HOUR), createdBy: ownerId,
      })

      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })

      assert.deepEqual(result, { ok: true, tenantId })

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.userId, inviteeId), eq(tenantMembers.tenantId, tenantId)))
      assert.equal(ms.length, 1)
      assert.equal(ms[0].role, 'MEMBER')

      const inv = await adminDb.select().from(invitations).where(eq(invitations.token, token))
      assert.equal(inv[0].status, 'accepted')
      assert.notEqual(inv[0].acceptedAt, null)
    })
  })

  test('NOT_FOUND for an unknown token', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { inviteeId } = await seedTenantAndUser(adminDb)
      const result = await acceptInvitation(adminDb, { token: 'nope', userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'NOT_FOUND' })
    })
  })

  test('EXPIRED past the expiry time', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'pending', expiresAt: new Date(Date.now() - HOUR), createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'EXPIRED' })
    })
  })

  test('ALREADY_ACCEPTED when the invite was already used', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'accepted', expiresAt: new Date(Date.now() + HOUR),
        acceptedAt: new Date(), createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'ALREADY_ACCEPTED' })
    })
  })

  test('ALREADY_MEMBER when the user is already in the tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { ownerId, inviteeId, tenantId } = await seedTenantAndUser(adminDb)
      await adminDb.insert(tenantMembers).values({ tenantId, userId: inviteeId, role: 'MEMBER' })
      const token = uuidv7()
      await adminDb.insert(invitations).values({
        id: uuidv7(), tenantId, email: 'guest@acme.com', token, role: 'MEMBER',
        status: 'pending', expiresAt: new Date(Date.now() + HOUR), createdBy: ownerId,
      })
      const result = await acceptInvitation(adminDb, { token, userId: inviteeId })
      assert.deepEqual(result, { ok: false, code: 'ALREADY_MEMBER' })
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @vibesboard/tenants test`
Expected: FAIL — `Cannot find module '../invitations.ts'`.

- [ ] **Step 3: Write the implementation**

`packages/tenants/src/invitations.ts`:

```ts
import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { tenantMembers, invitations } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

export interface AcceptInvitationInput {
  token: string
  userId: string
}

export type AcceptInvitationResult =
  | { ok: true; tenantId: string }
  | { ok: false; code: 'NOT_FOUND' | 'EXPIRED' | 'ALREADY_ACCEPTED' | 'INVALID' | 'ALREADY_MEMBER' }

/**
 * Accept a pending invitation: add the invited user as a tenant member with
 * the invited role and mark the invitation accepted. Identity-adjacent — pass
 * a BYPASSRLS migrate client (no tenant GUC context yet).
 */
export async function acceptInvitation(
  db: Db,
  input: AcceptInvitationInput,
): Promise<AcceptInvitationResult> {
  const rows = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, input.token))
    .limit(1)
  if (rows.length === 0) {
    return { ok: false, code: 'NOT_FOUND' }
  }
  const invite = rows[0]

  if (invite.expiresAt.getTime() < Date.now()) {
    return { ok: false, code: 'EXPIRED' }
  }
  if (invite.status === 'accepted') {
    return { ok: false, code: 'ALREADY_ACCEPTED' }
  }
  if (invite.status !== 'pending') {
    return { ok: false, code: 'INVALID' }
  }

  const member = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, invite.tenantId), eq(tenantMembers.userId, input.userId)))
    .limit(1)
  if (member.length > 0) {
    return { ok: false, code: 'ALREADY_MEMBER' }
  }

  await db.transaction(async (tx) => {
    await tx.insert(tenantMembers).values({
      tenantId: invite.tenantId,
      userId: input.userId,
      role: invite.role,
    })
    await tx
      .update(invitations)
      .set({ status: 'accepted', acceptedAt: new Date() })
      .where(eq(invitations.id, invite.id))
  })

  return { ok: true, tenantId: invite.tenantId }
}
```

- [ ] **Step 4: Export from the barrel**

Replace `packages/tenants/src/index.ts`:

```ts
// @vibesboard/tenants — workspace & membership operations on Postgres.
export * from './workspace.ts'
export * from './invitations.ts'
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @vibesboard/tenants test`
Expected: PASS — all tests in both `workspace.test.ts` and `invitations.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add packages/tenants/src/invitations.ts packages/tenants/src/index.ts packages/tenants/src/__tests__/invitations.test.ts
git commit -m "feat(tenants): acceptInvitation helper on Postgres"
```

---

## Task 5: Wire the invitations/accept route to the helper

**Files:**
- Modify: `apps/web/app/api/invitations/[token]/accept/route.ts`

- [ ] **Step 1: Replace the route body**

Replace the entire contents of `apps/web/app/api/invitations/[token]/accept/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { acceptInvitation } from '@vibesboard/tenants'
import { setActiveTenantId } from '@/lib/tenant-context'

export const runtime = 'nodejs'

type RouteParams = {
  params: Promise<{ token: string }>
}

/**
 * POST /api/invitations/[token]/accept
 * Accept invitation (authenticated user).
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requireAuth()
  if (!auth.ok) return auth.response

  const { token } = await params

  const result = await acceptInvitation(getMigrateDb(), {
    token,
    userId: auth.user.id,
  })

  // Success path first so TypeScript narrows `result` to the ok variant.
  if (result.ok) {
    await setActiveTenantId(result.tenantId)
    return NextResponse.json({ success: true, tenant_id: result.tenantId })
  }

  switch (result.code) {
    case 'NOT_FOUND':
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    case 'EXPIRED':
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
    case 'ALREADY_ACCEPTED':
      return NextResponse.json(
        { error: 'Invitation has already been accepted' },
        { status: 410 },
      )
    case 'INVALID':
      return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
    case 'ALREADY_MEMBER':
      return NextResponse.json(
        { error: 'You are already a member of this tenant' },
        { status: 409 },
      )
    default:
      return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
  }
}
```

- [ ] **Step 2: Type-check the web app**

Run: `pnpm --filter @vibesboard/web type-check`
Expected: PASS — no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/api/invitations/[token]/accept/route.ts
git commit -m "feat(tenants): invitations/accept route uses Postgres helper"
```

---

## Task 6: Delete the dead `on-user-created` Firebase-Auth trigger

`apps/functions/src/on-user-created.ts` is a Firebase **Auth** `onCreate` trigger. Authentication is on Better Auth now, so the trigger never fires; personal-tenant creation is handled by `@vibesboard/adapter-better-auth`'s `onUserCreateAfter` database hook. The file is dead code — remove it and its export.

**Files:**
- Delete: `apps/functions/src/on-user-created.ts`
- Modify: `apps/functions/src/index.ts`

- [ ] **Step 1: Inspect the current functions index**

Run: `grep -n "onUserCreated\|on-user-created" apps/functions/src/index.ts`
Expected: shows the `export { onUserCreated } from "./on-user-created";` line (around line 11) and a comment referencing it.

- [ ] **Step 2: Remove the export line**

Edit `apps/functions/src/index.ts`: delete the line `export { onUserCreated } from "./on-user-created";` and any comment line that solely documents the `onUserCreated` Auth trigger. Leave the remaining exports (e.g. `on-file-created`) intact.

- [ ] **Step 3: Delete the dead trigger file**

Run: `git rm apps/functions/src/on-user-created.ts`
Expected: file staged for deletion.

- [ ] **Step 4: Build the functions package to confirm nothing else references it**

Run: `pnpm build:functions`
Expected: PASS — TypeScript build succeeds with no "cannot find name onUserCreated" / missing-module errors.

- [ ] **Step 5: Commit**

```bash
git add apps/functions/src/index.ts
git commit -m "chore(functions): remove dead Firebase-Auth onUserCreated trigger

Auth is on Better Auth; the Firebase Auth onCreate trigger never fires.
Personal-tenant creation is handled by adapter-better-auth's onUserCreateAfter."
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the new package's full test suite**

Run: `pnpm --filter @vibesboard/tenants test`
Expected: PASS — all workspace + invitation tests green.

- [ ] **Step 2: Type-check the whole repo**

Run: `pnpm type-check`
Expected: PASS — no errors across packages and apps.

- [ ] **Step 3: Lint**

Run: `pnpm lint && pnpm format:check`
Expected: PASS. If `format:check` flags the new files, run `pnpm --filter @vibesboard/web format:write` for app files and re-check; fix any lint issues and amend the relevant commit.

- [ ] **Step 4: Confirm no Firestore remains in the migrated files**

Run: `grep -rn "adminDb\|firebase-admin/firestore" apps/web/app/api/tenants/create-team apps/web/app/api/invitations`
Expected: no matches.

- [ ] **Step 5: Staging smoke checklist (after deploy to `dev`)**

After the PR merges and Cloud Run deploys staging, verify manually:
- Sign in, open the workspace switcher, **create a team workspace** → returns 201, the new workspace appears, you are TENANT_ADMIN.
- Create a second workspace with the **same slug** → friendly 409 ("slug already exists").
- Create team workspaces up to the limit, then one more → **429** ("maximum of 5 team workspaces").
- Generate an invitation, **accept it** as a second user → 200, the invitee becomes a member with the invited role, active tenant switches to that workspace.
- Re-accepting the same invitation → 410 ("already been accepted").

---

## Notes for the executor

- **Postgres must be running** for the `@vibesboard/tenants` tests (`pnpm db:up`; `pnpm db:migrate` if needed). `withTestDb` creates an isolated schema per test run.
- **Why the migrate (BYPASSRLS) client?** Workspace creation and invite acceptance are identity-adjacent — they run before any tenant GUC context exists, so RLS `tenant_id = current_tenant_id` policies would match nothing. Per-row scoping is expressed explicitly in the `WHERE` clauses. This mirrors `lib/tenant-context.ts` and `adapter-better-auth/on-user-create.ts`.
- **`getMigrateDb()`** is the cached singleton migrate client (used by `lib/tenant-context.ts`); routes call it rather than creating a client per request.
- Default branding is intentionally not written on team-workspace creation: a tenant with no branding row inherits platform base branding. Branding is PR 1b.
