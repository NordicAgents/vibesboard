import { describe, it, expect } from 'vitest'
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

async function seedTenant(adminDb: any, slug = 'acme') {
  const userId = uuidv7()
  const tenantId = uuidv7()
  await adminDb.insert(users).values({ id: userId, email: `b-${userId}@acme.com`, name: 'B' })
  await adminDb
    .insert(tenants)
    .values({ id: tenantId, name: 'Acme', slug, createdBy: userId, isPersonal: false })
  return { userId, tenantId }
}

describe('getPlatformBranding', () => {
  it('returns the fallback when no platform_branding row exists', async () => {
    await withTestDb(async ({ adminDb }) => {
      const result = await getPlatformBranding(adminDb)
      expect(result).toEqual(PLATFORM_BRANDING_FALLBACK)
    })
  })

  it('returns the stored platform branding row when present', async () => {
    await withTestDb(async ({ adminDb }) => {
      await adminDb.insert(platformBranding).values({
        id: uuidv7(),
        primaryColor: '#111111',
        secondaryColor: '#222222',
        logoUrl: 'https://x/logo.png',
      })
      const result = await getPlatformBranding(adminDb)
      expect(result).toEqual({
        primaryColor: '#111111',
        secondaryColor: '#222222',
        logoUrl: 'https://x/logo.png',
      })
    })
  })
})

describe('getTenantBranding', () => {
  it('returns null when the tenant has no branding row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      expect(await getTenantBranding(adminDb, tenantId)).toBeNull()
    })
  })

  it('returns the branding row with overrides when present', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await adminDb.insert(tenantBranding).values({
        tenantId,
        primaryColor: '#aaaaaa',
        secondaryColor: '#bbbbbb',
        overrides: ['primaryColor'],
      })
      const row = await getTenantBranding(adminDb, tenantId)
      expect(row?.tenantId).toBe(tenantId)
      expect(row?.primaryColor).toBe('#aaaaaa')
      expect(row?.secondaryColor).toBe('#bbbbbb')
      expect(row?.overrides).toEqual(['primaryColor'])
    })
  })

  it('reads only the requested tenant branding (cross-tenant isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenant(adminDb, 'tenant-a')
      const b = await seedTenant(adminDb, 'tenant-b')
      await upsertTenantBranding(adminDb, a.tenantId, {
        primaryColor: '#a1a1a1',
        secondaryColor: '#a2a2a2',
        logoUrl: null,
        overrides: ['primaryColor'],
      })
      await upsertTenantBranding(adminDb, b.tenantId, {
        primaryColor: '#b1b1b1',
        secondaryColor: '#b2b2b2',
        logoUrl: null,
        overrides: ['secondaryColor'],
      })

      const rowA = await getTenantBranding(adminDb, a.tenantId)
      const rowB = await getTenantBranding(adminDb, b.tenantId)
      expect(rowA?.primaryColor).toBe('#a1a1a1')
      expect(rowB?.primaryColor).toBe('#b1b1b1')
      expect(rowA?.overrides).toEqual(['primaryColor'])
      expect(rowB?.overrides).toEqual(['secondaryColor'])
    })
  })
})

describe('upsertTenantBranding', () => {
  it('inserts a branding row then updates it (upsert on tenant_id)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      await upsertTenantBranding(adminDb, tenantId, {
        primaryColor: '#123456',
        secondaryColor: '#654321',
        logoUrl: null,
        overrides: ['primaryColor', 'secondaryColor'],
      })
      let rows = await adminDb
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.tenantId, tenantId))
      expect(rows.length).toBe(1)
      expect(rows[0].primaryColor).toBe('#123456')
      expect(rows[0].overrides).toEqual(['primaryColor', 'secondaryColor'])

      await upsertTenantBranding(adminDb, tenantId, {
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
        logoUrl: 'https://x/l.png',
        overrides: ['logoUrl'],
      })
      rows = await adminDb.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId))
      expect(rows.length).toBe(1)
      expect(rows[0].primaryColor).toBe('#000000')
      expect(rows[0].logoUrl).toBe('https://x/l.png')
      expect(rows[0].overrides).toEqual(['logoUrl'])
    })
  })

  it('updating one tenant branding does not touch another tenant (isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedTenant(adminDb, 'tenant-a')
      const b = await seedTenant(adminDb, 'tenant-b')
      await upsertTenantBranding(adminDb, a.tenantId, {
        primaryColor: '#aaaaaa',
        secondaryColor: '#cccccc',
        logoUrl: null,
        overrides: [],
      })
      await upsertTenantBranding(adminDb, b.tenantId, {
        primaryColor: '#bbbbbb',
        secondaryColor: '#dddddd',
        logoUrl: null,
        overrides: [],
      })

      await upsertTenantBranding(adminDb, a.tenantId, {
        primaryColor: '#aaaa00',
        secondaryColor: '#cccc00',
        logoUrl: null,
        overrides: ['primaryColor'],
      })

      const rowB = await getTenantBranding(adminDb, b.tenantId)
      expect(rowB?.primaryColor).toBe('#bbbbbb')
      expect(rowB?.secondaryColor).toBe('#dddddd')
    })
  })
})

describe('upsertPlatformBranding', () => {
  it('inserts the singleton then updates it (stays one row)', async () => {
    await withTestDb(async ({ adminDb }) => {
      await upsertPlatformBranding(adminDb, {
        primaryColor: '#111111',
        secondaryColor: '#222222',
        logoUrl: null,
        updatedBy: null,
      })
      let got = await getPlatformBranding(adminDb)
      expect(got).toEqual({ primaryColor: '#111111', secondaryColor: '#222222', logoUrl: undefined })

      await upsertPlatformBranding(adminDb, {
        primaryColor: '#333333',
        secondaryColor: '#444444',
        logoUrl: 'https://x/l.png',
        updatedBy: null,
      })
      got = await getPlatformBranding(adminDb)
      expect(got).toEqual({
        primaryColor: '#333333',
        secondaryColor: '#444444',
        logoUrl: 'https://x/l.png',
      })

      const rows = await adminDb.select().from(platformBranding)
      expect(rows.length).toBe(1)
      expect(rows[0].id).toBe(PLATFORM_BRANDING_ID)
    })
  })

  it('records the updatedBy user when provided', async () => {
    await withTestDb(async ({ adminDb }) => {
      const adminUser = uuidv7()
      await adminDb
        .insert(users)
        .values({ id: adminUser, email: 'super@acme.com', name: 'Super', isSuperAdmin: true })
      await upsertPlatformBranding(adminDb, {
        primaryColor: '#101010',
        secondaryColor: '#202020',
        logoUrl: null,
        updatedBy: adminUser,
      })
      const rows = await adminDb.select().from(platformBranding)
      expect(rows.length).toBe(1)
      expect(rows[0].updatedBy).toBe(adminUser)
    })
  })
})
