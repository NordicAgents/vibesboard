import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, agentLinks } from '@vibesboard/adapter-postgres/schema'
import { getAgentLinkBySlug, getAgentLinksForTenant, isLinkSlugAvailable } from './db.ts'

async function seed(adminDb: any) {
  const userId = randomUUID(); const tenantId = randomUUID(); const agentId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: 'o@a.com', name: 'O' })
  await adminDb.insert(tenants).values({ id: tenantId, name: 'Acme', slug: 'acme', createdBy: userId, isPersonal: false })
  await adminDb.insert(agents).values({ id: agentId, tenantId, userId, name: 'A', slug: 'a', instructions: '' })
  const linkId = randomUUID()
  await adminDb.insert(agentLinks).values({ id: linkId, tenantId, agentId, slug: 'promo', name: 'Promo', isActive: true, createdBy: userId })
  return { tenantId, agentId, linkId }
}

describe('agent-links db', () => {
  test('getAgentLinkBySlug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const l = await getAgentLinkBySlug(tenantId, 'promo', adminDb)
      assert.equal(l?.agentId, agentId); assert.equal(l?.isActive, true)
      assert.equal(await getAgentLinkBySlug(tenantId, 'nope', adminDb), null)
    })
  })
  test('getAgentLinksForTenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seed(adminDb)
      const links = await getAgentLinksForTenant(tenantId, adminDb)
      assert.equal(links.length, 1); assert.equal(links[0].slug, 'promo')
    })
  })
  test('isLinkSlugAvailable', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, linkId } = await seed(adminDb)
      assert.equal(await isLinkSlugAvailable('promo', tenantId, undefined, adminDb), false)
      assert.equal(await isLinkSlugAvailable('promo', tenantId, linkId, adminDb), true) // excludes self
      assert.equal(await isLinkSlugAvailable('free', tenantId, undefined, adminDb), true)
    })
  })
})
