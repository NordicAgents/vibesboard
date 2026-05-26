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
