import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  agents,
  conversations,
  dataConnections,
  dataActionLogs,
} from '@vibesboard/adapter-postgres/schema'
import { eq } from 'drizzle-orm'
import { recordDataActionLog } from '../action-logs.ts'

// Minimal fixtures: a user, tenant, agent and a connection that action logs
// can reference. Returns the generated ids so tests can wire FKs.
async function seedActionLogDeps(adminDb: any) {
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
    .values({ id: a, tenantId: t, userId: u, name: 'A', slug: `a-${a.slice(0, 8)}` })
  await adminDb.insert(dataConnections).values({
    id: c,
    tenantId: t,
    provider: 'airtable',
    name: 'AT',
    status: 'active',
    connectedBy: u,
  })
  return { u, t, a, c }
}

describe('recordDataActionLog', () => {
  it('inserts a success log row', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { t, a, c } = await seedActionLogDeps(adminDb)

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
      expect(rows.length).toBe(1)
      expect(rows[0].action).toBe('append_row')
      expect(rows[0].rowData).toEqual({ Name: 'Ada' })
      expect(rows[0].status).toBe('success')
      expect(rows[0].provider).toBe('airtable')
      expect(rows[0].tenantId).toBe(t)
      expect(rows[0].connectionId).toBe(c)
      expect(rows[0].externalRef).toBe('rec1')
      // Defaults for the omitted optional fields.
      expect(rows[0].conversationId).toBeNull()
      expect(rows[0].error).toBeNull()
      // A generated id and timestamp are present.
      expect(typeof rows[0].id).toBe('string')
      expect(rows[0].createdAt).toBeInstanceOf(Date)
    })
  })

  it('persists a failed log with an error message and conversationId', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { u, t, a, c } = await seedActionLogDeps(adminDb)
      const convId = randomUUID()
      await adminDb.insert(conversations).values({
        id: convId,
        tenantId: t,
        agentId: a,
      })

      await recordDataActionLog(
        {
          tenantId: t,
          agentId: a,
          conversationId: convId,
          connectionId: c,
          provider: 'google_sheets',
          action: 'append_row',
          status: 'failed',
          rowData: { foo: 'bar' },
          error: 'upstream 500',
        },
        adminDb,
      )

      const [row] = await adminDb
        .select()
        .from(dataActionLogs)
        .where(eq(dataActionLogs.agentId, a))
      expect(row.status).toBe('failed')
      expect(row.error).toBe('upstream 500')
      expect(row.conversationId).toBe(convId)
      expect(row.externalRef).toBeNull()
      expect(row.provider).toBe('google_sheets')
      // unused fixture var
      void u
    })
  })

  it('defaults conversationId/externalRef/error to null when omitted', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { t, a, c } = await seedActionLogDeps(adminDb)

      await recordDataActionLog(
        {
          tenantId: t,
          agentId: a,
          connectionId: c,
          provider: 'custom_webhook',
          action: 'append_row',
          status: 'success',
          rowData: {},
        },
        adminDb,
      )

      const [row] = await adminDb
        .select()
        .from(dataActionLogs)
        .where(eq(dataActionLogs.agentId, a))
      expect(row.conversationId).toBeNull()
      expect(row.externalRef).toBeNull()
      expect(row.error).toBeNull()
      expect(row.rowData).toEqual({})
    })
  })

  it('stores rowData as structured JSON (nested objects/arrays preserved)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { t, a, c } = await seedActionLogDeps(adminDb)
      const rowData = {
        name: 'Ada',
        tags: ['x', 'y'],
        nested: { deep: { value: 1 } },
        nullable: null,
      }

      await recordDataActionLog(
        {
          tenantId: t,
          agentId: a,
          connectionId: c,
          provider: 'airtable',
          action: 'append_row',
          status: 'success',
          rowData,
        },
        adminDb,
      )

      const [row] = await adminDb
        .select()
        .from(dataActionLogs)
        .where(eq(dataActionLogs.agentId, a))
      expect(row.rowData).toEqual(rowData)
    })
  })

  it('isolates logs by tenant/agent', async () => {
    await withTestDb(async ({ adminDb }) => {
      const first = await seedActionLogDeps(adminDb)
      const second = await seedActionLogDeps(adminDb)

      await recordDataActionLog(
        {
          tenantId: first.t,
          agentId: first.a,
          connectionId: first.c,
          provider: 'airtable',
          action: 'append_row',
          status: 'success',
          rowData: { who: 'first' },
        },
        adminDb,
      )
      await recordDataActionLog(
        {
          tenantId: second.t,
          agentId: second.a,
          connectionId: second.c,
          provider: 'airtable',
          action: 'append_row',
          status: 'success',
          rowData: { who: 'second' },
        },
        adminDb,
      )

      const firstRows = await adminDb
        .select()
        .from(dataActionLogs)
        .where(eq(dataActionLogs.tenantId, first.t))
      const secondRows = await adminDb
        .select()
        .from(dataActionLogs)
        .where(eq(dataActionLogs.tenantId, second.t))

      expect(firstRows.length).toBe(1)
      expect(firstRows[0].rowData).toEqual({ who: 'first' })
      expect(secondRows.length).toBe(1)
      expect(secondRows[0].rowData).toEqual({ who: 'second' })
    })
  })
})
