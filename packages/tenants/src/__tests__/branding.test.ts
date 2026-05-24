import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { uuidv7 } from 'uuidv7'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, tenantBranding, platformBranding } from '@vibesboard/adapter-postgres/schema'
import {
  getPlatformBranding,
  getTenantBranding,
  upsertTenantBranding,
  upsertPlatformBranding,
  PLATFORM_BRANDING_FALLBACK,
  PLATFORM_BRANDING_ID,
} from '../branding.ts'

async function seedTenant(adminDb: any) {
  const userId = uuidv7()
  const tenantId = uuidv7()
  await adminDb.insert(users).values({ id: userId, email: 'b@acme.com', name: 'B' })
  await adminDb.insert(tenants).values({ id: tenantId, name: 'Acme', slug: 'acme', createdBy: userId, isPersonal: false })
  return { userId, tenantId }
}

describe('getPlatformBranding', () => {
  test('returns the fallback when no platform_branding row exists', async () => {
    await withTestDb(async ({ adminDb }) => {
      const result = await getPlatformBranding(adminDb)
      assert.deepEqual(result, PLATFORM_BRANDING_FALLBACK)
    })
  })

  test('returns the stored platform branding row when present', async () => {
    await withTestDb(async ({ adminDb }) => {
      await adminDb.insert(platformBranding).values({
        id: uuidv7(), primaryColor: '#111111', secondaryColor: '#222222', logoUrl: 'https://x/logo.png',
      })
      const result = await getPlatformBranding(adminDb)
      assert.deepEqual(result, { primaryColor: '#111111', secondaryColor: '#222222', logoUrl: 'https://x/logo.png' })
    })
  })
})

describe('getTenantBranding', () => {
  test('returns null when the tenant has no branding row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      assert.equal(await getTenantBranding(adminDb, tenantId), null)
    })
  })

  test('returns the branding row with overrides when present', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await adminDb.insert(tenantBranding).values({
        tenantId, primaryColor: '#aaaaaa', secondaryColor: '#bbbbbb', overrides: ['primaryColor'],
      })
      const row = await getTenantBranding(adminDb, tenantId)
      assert.equal(row?.primaryColor, '#aaaaaa')
      assert.deepEqual(row?.overrides, ['primaryColor'])
    })
  })
})

describe('upsertTenantBranding', () => {
  test('inserts a branding row then updates it (upsert on tenant_id)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await upsertTenantBranding(adminDb, tenantId, {
        primaryColor: '#123456', secondaryColor: '#654321', logoUrl: null, overrides: ['primaryColor', 'secondaryColor'],
      })
      let rows = await adminDb.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId))
      assert.equal(rows.length, 1)
      assert.equal(rows[0].primaryColor, '#123456')
      assert.deepEqual(rows[0].overrides, ['primaryColor', 'secondaryColor'])

      await upsertTenantBranding(adminDb, tenantId, {
        primaryColor: '#000000', secondaryColor: '#ffffff', logoUrl: 'https://x/l.png', overrides: ['logoUrl'],
      })
      rows = await adminDb.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId))
      assert.equal(rows.length, 1)
      assert.equal(rows[0].primaryColor, '#000000')
      assert.equal(rows[0].logoUrl, 'https://x/l.png')
      assert.deepEqual(rows[0].overrides, ['logoUrl'])
    })
  })
})

describe('upsertPlatformBranding', () => {
  test('inserts the singleton then updates it (stays one row)', async () => {
    await withTestDb(async ({ adminDb }) => {
      await upsertPlatformBranding(adminDb, { primaryColor: '#111111', secondaryColor: '#222222', logoUrl: null, updatedBy: null })
      let got = await getPlatformBranding(adminDb)
      assert.deepEqual(got, { primaryColor: '#111111', secondaryColor: '#222222', logoUrl: undefined })

      await upsertPlatformBranding(adminDb, { primaryColor: '#333333', secondaryColor: '#444444', logoUrl: 'https://x/l.png', updatedBy: null })
      got = await getPlatformBranding(adminDb)
      assert.deepEqual(got, { primaryColor: '#333333', secondaryColor: '#444444', logoUrl: 'https://x/l.png' })

      const rows = await adminDb.select().from(platformBranding)
      assert.equal(rows.length, 1)
      assert.equal(rows[0].id, PLATFORM_BRANDING_ID)
    })
  })
})
