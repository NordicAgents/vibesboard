import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  agents,
  dataConnections,
  dataActionLogs,
} from '@vibesboard/adapter-postgres/schema'
import { eq } from 'drizzle-orm'
import { recordDataActionLog } from '../action-logs.ts'

describe('recordDataActionLog', () => {
  test('inserts a success log row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u = randomUUID()
      const t = randomUUID()
      const a = randomUUID()
      const c = randomUUID()
      await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
      await adminDb.insert(tenants).values({
        id: t,
        name: 'Acme',
        slug: `acme-${t.slice(0, 8)}`,
        createdBy: u,
        isPersonal: false,
      })
      await adminDb
        .insert(agents)
        .values({ id: a, tenantId: t, userId: u, name: 'A', slug: 'a' })
      await adminDb.insert(dataConnections).values({
        id: c,
        tenantId: t,
        provider: 'airtable',
        name: 'AT',
        status: 'active',
        connectedBy: u,
      })

      await recordDataActionLog(
        {
          tenantId: t,
          agentId: a,
          connectionId: c,
          provider: 'airtable',
          action: 'append_row',
          status: 'success',
          rowData: { Name: 'Ada' },
          externalRef: 'rec1',
        },
        adminDb,
      )

      const rows = await adminDb
        .select()
        .from(dataActionLogs)
        .where(eq(dataActionLogs.agentId, a))
      assert.equal(rows.length, 1)
      assert.equal(rows[0].action, 'append_row')
      assert.deepEqual(rows[0].rowData, { Name: 'Ada' })
    })
  })
})
