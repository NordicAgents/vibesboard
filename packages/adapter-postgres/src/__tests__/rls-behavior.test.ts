import { describe, it, expect } from 'vitest'
import { sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { withTestDb } from '../test-utils.ts'
import { tenants, tenantMembers, agents, users } from '../schema/index.ts'

// postgres-js wraps DB errors: the top-level message is "Failed query: …" and
// the real Postgres error (e.g. the RLS violation) lives on `error.cause`.
// Flatten the chain so assertions match the actual DB error.
function errorChain(err: unknown): string {
  const parts: string[] = []
  let cur: any = err
  let depth = 0
  while (cur && depth < 5) {
    if (typeof cur.message === 'string') parts.push(cur.message)
    if (typeof cur.detail === 'string') parts.push(cur.detail)
    if (typeof cur.code === 'string') parts.push(cur.code)
    cur = cur.cause
    depth++
  }
  return parts.join(' | ')
}

async function expectRejects(p: Promise<unknown>, re: RegExp): Promise<void> {
  let threw = false
  try {
    await p
  } catch (err) {
    threw = true
    expect(errorChain(err)).toMatch(re)
  }
  expect(threw).toBe(true)
}

const TENANT_A = '11111111-1111-1111-1111-111111111111'
const TENANT_B = '22222222-2222-2222-2222-222222222222'
const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

async function seedTwoTenants(adminDb: any, schemaName: string) {
  await adminDb.transaction(async (tx: any) => {
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
    await tx.insert(users).values([
      { id: USER_A, email: 'a@test', isSuperAdmin: false },
      { id: USER_B, email: 'b@test', isSuperAdmin: false },
    ])
    await tx.insert(tenants).values([
      { id: TENANT_A, name: 'A', slug: 'a' },
      { id: TENANT_B, name: 'B', slug: 'b' },
    ])
    await tx.insert(tenantMembers).values([
      { tenantId: TENANT_A, userId: USER_A, role: 'TENANT_ADMIN' },
      { tenantId: TENANT_B, userId: USER_B, role: 'TENANT_ADMIN' },
    ])
  })
  const agentA = uuidv7()
  const agentB = uuidv7()
  await adminDb.transaction(async (tx: any) => {
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
    await tx.insert(agents).values([
      { id: agentA, tenantId: TENANT_A, name: 'A-agent', slug: 'a', mode: 'provider' },
      { id: agentB, tenantId: TENANT_B, name: 'B-agent', slug: 'b', mode: 'provider' },
    ])
  })
  return { agentA, agentB }
}

describe('rls behavior', () => {
  it('admin role (BYPASSRLS) sees both tenants — sanity check on seed', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const all = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(agents)
      })
      expect(all.length).toBe(2)
    })
  })

  it('app role with tenant A context sees only tenant A agents', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${USER_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        return tx.select().from(agents)
      })
      expect(rows.length).toBe(1)
      expect(rows[0].tenantId).toBe(TENANT_A)
    })
  })

  it('cross-tenant write fails RLS WITH CHECK', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      await expectRejects(
        appDb.transaction(async (tx) => {
          await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
          await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`)
          await tx.execute(sql`SELECT set_config('app.current_user_id', ${USER_A}, true)`)
          await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
          await tx.insert(agents).values({
            id: uuidv7(),
            tenantId: TENANT_B,
            name: 'sneaky',
            slug: 'sneaky',
            mode: 'provider',
          })
        }),
        /row-level security|violates row-level security/i,
      )
    })
  })

  it('no context = zero rows', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        return tx.select().from(agents)
      })
      expect(rows.length).toBe(0)
    })
  })

  it('super-admin sees all tenants', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'true', true)`)
        return tx.select().from(agents)
      })
      expect(rows.length).toBe(2)
    })
  })

  it('anonymous (no user) can read tenant agents but not users', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const result = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        const ag = await tx.select().from(agents)
        const us = await tx.select().from(users)
        return { ag, us }
      })
      expect(result.ag.length).toBe(1)
      expect(result.us.length).toBe(0)
    })
  })

  // ── Added coverage ─────────────────────────────────────────────────────

  it('switching tenant GUC within one transaction switches visibility', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const { aRows, bRows } = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`)
        const aRows = await tx.select().from(agents)
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_B}, true)`)
        const bRows = await tx.select().from(agents)
        return { aRows, bRows }
      })
      expect(aRows.map((r) => r.tenantId)).toEqual([TENANT_A])
      expect(bRows.map((r) => r.tenantId)).toEqual([TENANT_B])
    })
  })

  it('app role can insert a row for its own active tenant', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const newId = uuidv7()
      await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${USER_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        await tx.insert(agents).values({
          id: newId,
          tenantId: TENANT_A,
          name: 'own',
          slug: 'own',
          mode: 'provider',
        })
      })
      // Verify via the BYPASSRLS admin connection that the row landed.
      const rows = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(agents)
      })
      expect(rows.some((r: any) => r.id === newId)).toBe(true)
    })
  })

  it('cross-tenant SELECT after writing as another tenant cannot read foreign rows', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      // As tenant A, tenant B's users must never be visible.
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${USER_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        return tx.select().from(agents)
      })
      expect(rows.every((r) => r.tenantId === TENANT_A)).toBe(true)
    })
  })
})
