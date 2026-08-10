import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  getAgentForMember,
  getAgentForUser,
  getAgentById,
  getAgentBySlug,
  getAgentNamesByTenant,
  getAgentsForTenant,
  disableAgentsForConnection,
} from '../server.ts'

async function seed(adminDb: any) {
  const userId = randomUUID()
  const tenantId = randomUUID()
  const agentId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: 'o@a.com', name: 'O' })
  await adminDb.insert(tenants).values({
    id: tenantId,
    name: 'Acme',
    slug: 'acme',
    createdBy: userId,
    isPersonal: false,
  })
  await adminDb.insert(agents).values({
    id: agentId,
    tenantId,
    userId,
    name: 'Support',
    slug: 'support',
    instructions: 'hi',
  })
  return { userId, tenantId, agentId }
}

describe('agent server reads', () => {
  it('rejects malformed member lookup ids without querying Postgres', async () => {
    const db = {
      select: vi.fn(() => {
        throw new Error('database should not be queried')
      }),
    }

    await expect(
      getAgentForMember('not-a-tenant-uuid', 'not-an-agent-uuid', db as never),
    ).resolves.toBeNull()
    await expect(
      getAgentForUser(randomUUID(), 'not-an-agent-uuid', randomUUID(), db as never),
    ).resolves.toBeNull()
    expect(db.select).not.toHaveBeenCalled()
  })

  it('getAgentForMember maps row + tenantSlug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      const a = await getAgentForMember(tenantId, agentId, adminDb)
      expect(a?.id).toBe(agentId)
      expect(a?.agentUrl).toBe('support')
      expect(a?.tenantSlug).toBe('acme')
    })
  })

  it('getAgentById finds across tenants', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId } = await seed(adminDb)
      expect((await getAgentById(agentId, adminDb))?.id).toBe(agentId)
      expect(await getAgentById(randomUUID(), adminDb)).toBe(null)
    })
  })

  it('getAgentBySlug', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seed(adminDb)
      expect((await getAgentBySlug(tenantId, 'support', adminDb))?.name).toBe('Support')
      expect(await getAgentBySlug(tenantId, 'nope', adminDb)).toBe(null)
    })
  })

  it('getAgentForUser respects ownership', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seed(adminDb)
      expect((await getAgentForUser(tenantId, agentId, userId, adminDb))?.id).toBe(agentId)
      expect(await getAgentForUser(tenantId, agentId, randomUUID(), adminDb)).toBe(null)
    })
  })

  it('getAgentNamesByTenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId } = await seed(adminDb)
      expect(await getAgentNamesByTenant(tenantId, [agentId], adminDb)).toEqual({
        [agentId]: 'Support',
      })
      expect(await getAgentNamesByTenant(tenantId, [], adminDb)).toEqual({})
    })
  })

  it('getAgentsForTenant lists agents for the tenant, newest first, mapped', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seed(adminDb)
      // a second, newer agent in the same tenant
      const newerId = randomUUID()
      await adminDb.insert(agents).values({
        id: newerId,
        tenantId,
        userId,
        name: 'Sales',
        slug: 'sales',
        instructions: 'hi',
        createdAt: new Date(Date.now() + 1000),
      })
      // an agent in a different tenant — must NOT appear
      const otherTenant = randomUUID()
      await adminDb.insert(tenants).values({
        id: otherTenant,
        name: 'Other',
        slug: 'other',
        createdBy: userId,
        isPersonal: false,
      })
      await adminDb.insert(agents).values({
        id: randomUUID(),
        tenantId: otherTenant,
        userId,
        name: 'Nope',
        slug: 'nope',
        instructions: 'hi',
      })

      const list = await getAgentsForTenant(tenantId, adminDb)
      expect(list.length).toBe(2)
      expect(list.map((a) => a.id)).toEqual([newerId, agentId]) // newest first
      expect(list[0].tenantSlug).toBe('acme')
      expect(list[1].agentUrl).toBe('support')
    })
  })

  it('getAgentsForTenant returns [] for a tenant with no agents', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { userId } = await seed(adminDb)
      const empty = randomUUID()
      await adminDb.insert(tenants).values({
        id: empty,
        name: 'Empty',
        slug: 'empty',
        createdBy: userId,
        isPersonal: false,
      })
      expect(await getAgentsForTenant(empty, adminDb)).toEqual([])
    })
  })
})

describe('disableAgentsForConnection', () => {
  it('disables availability + scheduling configs referencing the connection', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u = randomUUID()
      const t = randomUUID()
      const connId = randomUUID()
      const otherConn = randomUUID()
      await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
      await adminDb.insert(tenants).values({
        id: t,
        name: 'Acme',
        slug: `acme-${t.slice(0, 8)}`,
        createdBy: u,
        isPersonal: false,
      })
      const a1 = randomUUID()
      const a2 = randomUUID()
      const a3 = randomUUID()
      // a1 references connId via availability config
      await adminDb.insert(agents).values({
        id: a1,
        tenantId: t,
        userId: u,
        name: 'A1',
        slug: 'a1',
        calendarAvailabilityConfig: { enabled: true, calendarConnectionId: connId },
      })
      // a2 references connId via scheduling config
      await adminDb.insert(agents).values({
        id: a2,
        tenantId: t,
        userId: u,
        name: 'A2',
        slug: 'a2',
        schedulingConfig: {
          enabled: true,
          calendarConnectionId: connId,
          defaultDurationMinutes: 30,
          bufferMinutes: 0,
          timezone: 'UTC',
          availableHours: { start: '09:00', end: '17:00' },
          availableDays: [1, 2, 3, 4, 5],
          meetingTitleTemplate: 'x',
          createMeetLink: false,
        },
      })
      // a3 references a DIFFERENT connection — must stay enabled
      await adminDb.insert(agents).values({
        id: a3,
        tenantId: t,
        userId: u,
        name: 'A3',
        slug: 'a3',
        schedulingConfig: {
          enabled: true,
          calendarConnectionId: otherConn,
          defaultDurationMinutes: 30,
          bufferMinutes: 0,
          timezone: 'UTC',
          availableHours: { start: '09:00', end: '17:00' },
          availableDays: [1, 2, 3, 4, 5],
          meetingTitleTemplate: 'x',
          createMeetLink: false,
        },
      })

      await disableAgentsForConnection(t, connId, adminDb)

      const [r1] = await adminDb.select().from(agents).where(eq(agents.id, a1))
      const [r2] = await adminDb.select().from(agents).where(eq(agents.id, a2))
      const [r3] = await adminDb.select().from(agents).where(eq(agents.id, a3))
      expect(r1.calendarAvailabilityConfig?.enabled).toBe(false)
      expect(r2.schedulingConfig?.enabled).toBe(false)
      expect(r3.schedulingConfig?.enabled).toBe(true) // untouched
    })
  })

  it('only disables configs for the matching connection in the same tenant', async () => {
    await withTestDb(async ({ adminDb }) => {
      const u = randomUUID()
      const tA = randomUUID()
      const tB = randomUUID()
      const connId = randomUUID()
      await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
      await adminDb.insert(tenants).values({
        id: tA,
        name: 'A',
        slug: `a-${tA.slice(0, 8)}`,
        createdBy: u,
        isPersonal: false,
      })
      await adminDb.insert(tenants).values({
        id: tB,
        name: 'B',
        slug: `b-${tB.slice(0, 8)}`,
        createdBy: u,
        isPersonal: false,
      })
      const agentA = randomUUID()
      const agentB = randomUUID()
      // Agent in tenant A references connId
      await adminDb.insert(agents).values({
        id: agentA,
        tenantId: tA,
        userId: u,
        name: 'A',
        slug: 'a',
        calendarAvailabilityConfig: { enabled: true, calendarConnectionId: connId },
      })
      // Agent in tenant B references the SAME connId value — must stay enabled
      // because disable is tenant-scoped (cross-tenant isolation).
      await adminDb.insert(agents).values({
        id: agentB,
        tenantId: tB,
        userId: u,
        name: 'B',
        slug: 'b',
        calendarAvailabilityConfig: { enabled: true, calendarConnectionId: connId },
      })

      await disableAgentsForConnection(tA, connId, adminDb)

      const [rA] = await adminDb.select().from(agents).where(eq(agents.id, agentA))
      const [rB] = await adminDb.select().from(agents).where(eq(agents.id, agentB))
      expect(rA.calendarAvailabilityConfig?.enabled).toBe(false)
      expect(rB.calendarAvailabilityConfig?.enabled).toBe(true) // other tenant untouched
    })
  })
})
