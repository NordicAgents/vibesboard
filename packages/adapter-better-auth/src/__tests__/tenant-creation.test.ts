import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantMembers } from '@vibesboard/adapter-postgres/schema'

async function runHook(
  adminDb: any,
  user: { id: string; email: string; name?: string | null },
) {
  const existing = await adminDb
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, user.id))
    .limit(1)
  if (existing.length > 0) return

  const base =
    user.email
      .split('@')[0]
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 32) || 'workspace'

  let slug = base
  let suffix = 0
  while (suffix < 100) {
    const collision = await adminDb
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1)
    if (collision.length === 0) break
    suffix++
    slug = `${base}-${suffix}`
  }

  const tenantId = uuidv7()
  await adminDb.transaction(async (tx: any) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: user.name ?? `${user.email.split('@')[0]}'s workspace`,
      slug,
      createdBy: user.id,
      isPersonal: true,
    })
    await tx.insert(tenantMembers).values({
      tenantId,
      userId: user.id,
      role: 'TENANT_ADMIN',
    })
  })
}

describe('onUserCreate (auto-tenant creation)', () => {
  test('creates a personal tenant + TENANT_ADMIN membership for a new user', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'alice@acme.com', name: 'Alice' })

      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' })

      const ts = await adminDb.select().from(tenants).where(eq(tenants.createdBy, userId))
      assert.equal(ts.length, 1)
      assert.equal(ts[0].slug, 'alice')
      assert.equal(ts[0].isPersonal, true)

      const ms = await adminDb.select().from(tenantMembers).where(eq(tenantMembers.userId, userId))
      assert.equal(ms.length, 1)
      assert.equal(ms[0].role, 'TENANT_ADMIN')
      assert.equal(ms[0].tenantId, ts[0].id)
    })
  })

  test('local-part collision uniques the slug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u1 = uuidv7()
      const u2 = uuidv7()
      await adminDb.insert(users).values([
        { id: u1, email: 'alice@one.com', name: 'Alice' },
        { id: u2, email: 'alice@two.com', name: 'Alice2' },
      ])
      await runHook(adminDb, { id: u1, email: 'alice@one.com', name: 'Alice' })
      await runHook(adminDb, { id: u2, email: 'alice@two.com', name: 'Alice2' })

      const slugs = (await adminDb.select({ slug: tenants.slug }).from(tenants))
        .map((r: { slug: string }) => r.slug)
        .sort()
      assert.deepEqual(slugs, ['alice', 'alice-1'])
    })
  })

  test('is idempotent — second run for the same user does nothing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = uuidv7()
      await adminDb.insert(users).values({ id: userId, email: 'alice@acme.com', name: 'Alice' })

      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' })
      await runHook(adminDb, { id: userId, email: 'alice@acme.com', name: 'Alice' })

      const ts = await adminDb.select().from(tenants).where(eq(tenants.createdBy, userId))
      assert.equal(ts.length, 1)
      const ms = await adminDb.select().from(tenantMembers).where(eq(tenantMembers.userId, userId))
      assert.equal(ms.length, 1)
    })
  })
})
