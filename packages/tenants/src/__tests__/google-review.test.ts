import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants } from '@vibesboard/adapter-postgres/schema'
import {
  getTenantGooglePlaceId,
  setTenantGooglePlaceId,
  getTenantIsPersonal,
} from '../google-review.ts'

async function seedTenant(adminDb: any, isPersonal = false) {
  const u = randomUUID()
  const t = randomUUID()
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
  it('get returns null initially, set persists, clearing resets to null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      expect(await getTenantGooglePlaceId(tenantId, adminDb)).toBeNull()
      expect(await getTenantIsPersonal(tenantId, adminDb)).toBe(false)

      await setTenantGooglePlaceId(tenantId, 'ChIJ123', adminDb)
      expect(await getTenantGooglePlaceId(tenantId, adminDb)).toBe('ChIJ123')

      await setTenantGooglePlaceId(tenantId, null, adminDb)
      expect(await getTenantGooglePlaceId(tenantId, adminDb)).toBeNull()
    })
  })

  it('setTenantGooglePlaceId overwrites a previously set value', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await setTenantGooglePlaceId(tenantId, 'ChIJ-first', adminDb)
      await setTenantGooglePlaceId(tenantId, 'ChIJ-second', adminDb)
      expect(await getTenantGooglePlaceId(tenantId, adminDb)).toBe('ChIJ-second')
    })
  })

  it('isPersonal reflects a personal workspace; missing tenant returns null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb, true)
      expect(await getTenantIsPersonal(tenantId, adminDb)).toBe(true)
      expect(await getTenantGooglePlaceId(randomUUID(), adminDb)).toBeNull()
      expect(await getTenantIsPersonal(randomUUID(), adminDb)).toBeNull()
    })
  })

  it('place id is per-tenant: setting one does not affect another (isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenant(adminDb)
      const b = await seedTenant(adminDb)
      await setTenantGooglePlaceId(a.tenantId, 'ChIJ-A', adminDb)

      expect(await getTenantGooglePlaceId(a.tenantId, adminDb)).toBe('ChIJ-A')
      expect(await getTenantGooglePlaceId(b.tenantId, adminDb)).toBeNull()
    })
  })
})
