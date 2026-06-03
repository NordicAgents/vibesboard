import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, agentLinks } from '@vibesboard/adapter-postgres/schema'
import { getAgentLinkBySlug, getAgentLinksForTenant, isLinkSlugAvailable, createAgentLink, getAgentLinkById, updateAgentLink, deleteAgentLink } from './db.ts'

async function seed(adminDb: any) {
  const userId = randomUUID(); const tenantId = randomUUID(); const agentId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: 'o@a.com', name: 'O' })
  await adminDb.insert(tenants).values({ id: tenantId, name: 'Acme', slug: 'acme', createdBy: userId, isPersonal: false })
  await adminDb.insert(agents).values({ id: agentId, tenantId, userId, name: 'A', slug: 'a', instructions: '' })
  const linkId = randomUUID()
  await adminDb.insert(agentLinks).values({ id: linkId, tenantId, agentId, slug: 'promo', name: 'Promo', isActive: true, createdBy: userId })
  return { userId, tenantId, agentId, linkId }
}

// Seed a second, fully independent tenant (unique slugs/emails) in the same
// test schema so cross-tenant isolation can be asserted.
async function seedOther(adminDb: any) {
  const userId = randomUUID(); const tenantId = randomUUID(); const agentId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: `o-${userId}@b.com`, name: 'B' })
  await adminDb.insert(tenants).values({ id: tenantId, name: 'Beta', slug: `beta-${tenantId}`.slice(0, 40), createdBy: userId, isPersonal: false })
  await adminDb.insert(agents).values({ id: agentId, tenantId, userId, name: 'B', slug: 'b', instructions: '' })
  const linkId = randomUUID()
  await adminDb.insert(agentLinks).values({ id: linkId, tenantId, agentId, slug: 'promo', name: 'OtherPromo', isActive: true, createdBy: userId })
  return { userId, tenantId, agentId, linkId }
}

describe('agent-links db', () => {
  it('getAgentLinkBySlug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const l = await getAgentLinkBySlug(tenantId, 'promo', adminDb)
      expect(l?.agentId).toBe(agentId); expect(l?.isActive).toBe(true)
      expect(await getAgentLinkBySlug(tenantId, 'nope', adminDb)).toBe(null)
    })
  })
  it('getAgentLinksForTenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seed(adminDb)
      const links = await getAgentLinksForTenant(tenantId, adminDb)
      expect(links.length).toBe(1); expect(links[0].slug).toBe('promo')
    })
  })
  it('isLinkSlugAvailable', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, linkId } = await seed(adminDb)
      expect(await isLinkSlugAvailable('promo', tenantId, undefined, adminDb)).toBe(false)
      expect(await isLinkSlugAvailable('promo', tenantId, linkId, adminDb)).toBe(true) // excludes self
      expect(await isLinkSlugAvailable('free', tenantId, undefined, adminDb)).toBe(true)
    })
  })
})

describe('agent-links CRUD', () => {
  it('createAgentLink inserts + getAgentLinkById fetches', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seed(adminDb)
      const link = await createAgentLink({ tenantId, agentId, slug: 'sale', name: 'Sale', createdBy: userId }, adminDb)
      expect(link.slug).toBe('sale'); expect(link.isActive).toBe(true)
      const got = await getAgentLinkById(tenantId, link.id, adminDb)
      expect(got?.name).toBe('Sale')
      expect(await getAgentLinkById(tenantId, randomUUID(), adminDb)).toBe(null)
    })
  })
  it('updateAgentLink + deleteAgentLink', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, linkId } = await seed(adminDb)
      const upd = await updateAgentLink(tenantId, linkId, { name: 'Renamed', isActive: false }, adminDb)
      expect(upd?.name).toBe('Renamed'); expect(upd?.isActive).toBe(false)
      expect(await updateAgentLink(tenantId, randomUUID(), { name: 'x' }, adminDb)).toBe(null)
      expect(await deleteAgentLink(tenantId, linkId, adminDb)).toBe(true)
      expect(await deleteAgentLink(tenantId, linkId, adminDb)).toBe(false)
    })
  })
})

// Cross-tenant isolation invariant: every read path in db.ts is scoped by
// tenantId, so a query for tenant A must never observe tenant B's links —
// even when both tenants happen to use the same link slug.
describe('agent-links cross-tenant isolation', () => {
  it('listing is scoped: tenant A never sees tenant B links', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seedOther(adminDb)

      const aLinks = await getAgentLinksForTenant(a.tenantId, adminDb)
      const bLinks = await getAgentLinksForTenant(b.tenantId, adminDb)

      expect(aLinks.length).toBe(1)
      expect(bLinks.length).toBe(1)
      expect(aLinks.every((l) => l.tenantId === a.tenantId)).toBe(true)
      expect(bLinks.every((l) => l.tenantId === b.tenantId)).toBe(true)
      // No id leaks across the boundary.
      const aIds = new Set(aLinks.map((l) => l.id))
      expect(bLinks.some((l) => aIds.has(l.id))).toBe(false)
    })
  })

  it('getAgentLinkBySlug is scoped: shared slug resolves per tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seedOther(adminDb)
      // Both tenants have a 'promo' link; each resolves only its own.
      const fromA = await getAgentLinkBySlug(a.tenantId, 'promo', adminDb)
      const fromB = await getAgentLinkBySlug(b.tenantId, 'promo', adminDb)
      expect(fromA?.tenantId).toBe(a.tenantId)
      expect(fromB?.tenantId).toBe(b.tenantId)
      expect(fromA?.name).toBe('Promo')
      expect(fromB?.name).toBe('OtherPromo')
    })
  })

  it('getAgentLinkById is scoped: tenant A cannot fetch tenant B link by id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seedOther(adminDb)
      // Tenant A asks for tenant B's link id under its own tenant scope.
      expect(await getAgentLinkById(a.tenantId, b.linkId, adminDb)).toBe(null)
      // But tenant B can fetch its own.
      expect((await getAgentLinkById(b.tenantId, b.linkId, adminDb))?.id).toBe(b.linkId)
    })
  })

  it('mutations are scoped: tenant A cannot update or delete tenant B link', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seed(adminDb)
      const b = await seedOther(adminDb)
      // Cross-tenant update is a no-op (no row matches A's scope + B's id).
      expect(await updateAgentLink(a.tenantId, b.linkId, { name: 'Hijack' }, adminDb)).toBe(null)
      // Cross-tenant delete affects zero rows.
      expect(await deleteAgentLink(a.tenantId, b.linkId, adminDb)).toBe(false)
      // Tenant B's link survives untouched.
      const survivor = await getAgentLinkById(b.tenantId, b.linkId, adminDb)
      expect(survivor?.name).toBe('OtherPromo')
    })
  })
})
