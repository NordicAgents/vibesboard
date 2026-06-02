import { describe, it, expect } from 'vitest'
import { uuidv7 } from 'uuidv7'
import { eq, and } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'
import { createTeamWorkspace, MAX_TEAM_WORKSPACES } from '../workspace.ts'

describe('createTeamWorkspace', () => {
  it('creates a non-personal tenant + TENANT_ADMIN membership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })

      const result = await createTeamWorkspace(adminDb, {
        userId,
        name: 'Acme Team',
        slug: 'acme-team',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.tenant.slug).toBe('acme-team')
      expect(result.tenant.name).toBe('Acme Team')
      expect(result.tenant.isPersonal).toBe(false)
      expect(result.tenant.status).toBe('pending')
      expect(result.tenant.createdBy).toBe(userId)
      expect(typeof result.tenant.createdAt).toBe('string')
      expect(typeof result.tenant.updatedAt).toBe('string')

      const ms = await adminDb
        .select()
        .from(tenantMembers)
        .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, result.tenant.id)))
      expect(ms.length).toBe(1)
      expect(ms[0].role).toBe('TENANT_ADMIN')
    })
  })

  it('returns SLUG_TAKEN when the slug already exists', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })
      await adminDb.insert(tenants).values({
        id: uuidv7(),
        name: 'Existing',
        slug: 'taken',
        createdBy: userId,
        isPersonal: false,
      })

      const result = await createTeamWorkspace(adminDb, { userId, name: 'New', slug: 'taken' })

      expect(result).toEqual({ ok: false, code: 'SLUG_TAKEN' })
    })
  })

  it('returns LIMIT after MAX_TEAM_WORKSPACES non-personal tenants', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })
      for (let i = 0; i < MAX_TEAM_WORKSPACES; i++) {
        const tid = uuidv7()
        await adminDb.insert(tenants).values({
          id: tid,
          name: `T${i}`,
          slug: `team-${i}`,
          createdBy: userId,
          isPersonal: false,
        })
        await adminDb.insert(tenantMembers).values({ tenantId: tid, userId, role: 'TENANT_ADMIN' })
      }

      const result = await createTeamWorkspace(adminDb, {
        userId,
        name: 'One Too Many',
        slug: 'overflow',
      })

      expect(result).toEqual({ ok: false, code: 'LIMIT' })
    })
  })

  it('allows the Nth team workspace right up to the limit (one below MAX)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })
      for (let i = 0; i < MAX_TEAM_WORKSPACES - 1; i++) {
        const tid = uuidv7()
        await adminDb.insert(tenants).values({
          id: tid,
          name: `T${i}`,
          slug: `team-${i}`,
          createdBy: userId,
          isPersonal: false,
        })
        await adminDb.insert(tenantMembers).values({ tenantId: tid, userId, role: 'TENANT_ADMIN' })
      }

      const result = await createTeamWorkspace(adminDb, {
        userId,
        name: 'Last Allowed',
        slug: 'last-allowed',
      })

      expect(result.ok).toBe(true)
    })
  })

  it('personal tenants do not count toward the team limit', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'owner@acme.com', name: 'Owner' })
      const personal = uuidv7()
      await adminDb.insert(tenants).values({
        id: personal,
        name: 'Personal',
        slug: 'owner',
        createdBy: userId,
        isPersonal: true,
      })
      await adminDb.insert(tenantMembers).values({ tenantId: personal, userId, role: 'TENANT_ADMIN' })

      const result = await createTeamWorkspace(adminDb, {
        userId,
        name: 'First Team',
        slug: 'first-team',
      })

      expect(result.ok).toBe(true)
    })
  })

  it("a user's team workspaces do not consume another user's quota (per-user isolation)", async () => {
    await withTestDb(async ({ adminDb }) => {
      const userA = uuidv7()
      const userB = uuidv7()
      await adminDb.insert(users).values([
        { id: userA, email: 'a@acme.com', name: 'A' },
        { id: userB, email: 'b@acme.com', name: 'B' },
      ])
      for (let i = 0; i < MAX_TEAM_WORKSPACES; i++) {
        const tid = uuidv7()
        await adminDb.insert(tenants).values({
          id: tid,
          name: `A-T${i}`,
          slug: `a-team-${i}`,
          createdBy: userA,
          isPersonal: false,
        })
        await adminDb.insert(tenantMembers).values({ tenantId: tid, userId: userA, role: 'TENANT_ADMIN' })
      }

      const blocked = await createTeamWorkspace(adminDb, {
        userId: userA,
        name: 'A overflow',
        slug: 'a-overflow',
      })
      expect(blocked).toEqual({ ok: false, code: 'LIMIT' })

      const allowed = await createTeamWorkspace(adminDb, {
        userId: userB,
        name: 'B first',
        slug: 'b-first',
      })
      expect(allowed.ok).toBe(true)
    })
  })
})
