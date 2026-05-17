import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { withTestDb } from '../test-utils.ts'
import { tenants, tenantMembers, agents, users } from '../schema/index.ts'

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
  test('admin role (BYPASSRLS) sees both tenants — sanity check on seed', async () => {
    await withTestDb(async ({ adminDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const all = await adminDb.transaction(async (tx: any) => {
        await tx.execute(sql.raw(`SET LOCAL search_path TO "${schemaName}", public`))
        return tx.select().from(agents)
      })
      assert.equal(all.length, 2)
    })
  })

  test('app role with tenant A context sees only tenant A agents', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${TENANT_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', ${USER_A}, true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        return tx.select().from(agents)
      })
      assert.equal(rows.length, 1)
      assert.equal(rows[0].tenantId, TENANT_A)
    })
  })

  test('cross-tenant write fails RLS WITH CHECK', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      await assert.rejects(
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

  test('no context = zero rows', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        return tx.select().from(agents)
      })
      assert.equal(rows.length, 0)
    })
  })

  test('super-admin sees all tenants', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      await seedTwoTenants(adminDb, schemaName)
      const rows = await appDb.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.current_user_id', '', true)`)
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'true', true)`)
        return tx.select().from(agents)
      })
      assert.equal(rows.length, 2)
    })
  })

  test('anonymous (no user) can read tenant agents but not users', async () => {
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
      assert.equal(result.ag.length, 1, 'should see tenant A agents')
      assert.equal(result.us.length, 0, 'should NOT see users (no user context)')
    })
  })
})
