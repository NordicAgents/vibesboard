import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  getTenantGooglePlaceId,
  setTenantGooglePlaceId,
  getTenantIsPersonal,
} from '../google-review.ts'

async function seedTenant(adminDb: any, isPersonal = false) {
  const u = randomUUID(),
    t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal,
  })
  return { tenantId: t }
}

describe('tenant google review (postgres)', () => {
  test('get returns null initially, set persists, isPersonal reflects column', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      assert.equal(await getTenantGooglePlaceId(tenantId, adminDb), null)
      assert.equal(await getTenantIsPersonal(tenantId, adminDb), false)
      await setTenantGooglePlaceId(tenantId, 'ChIJ123', adminDb)
      assert.equal(await getTenantGooglePlaceId(tenantId, adminDb), 'ChIJ123')
      await setTenantGooglePlaceId(tenantId, null, adminDb)
      assert.equal(await getTenantGooglePlaceId(tenantId, adminDb), null)
    })
  })

  test('isPersonal reflects a personal workspace; missing tenant returns null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb, true)
      assert.equal(await getTenantIsPersonal(tenantId, adminDb), true)
      assert.equal(await getTenantGooglePlaceId(randomUUID(), adminDb), null)
      assert.equal(await getTenantIsPersonal(randomUUID(), adminDb), null)
    })
  })
})
