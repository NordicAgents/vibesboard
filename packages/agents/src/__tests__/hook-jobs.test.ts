import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  agents,
  hooks
} from '@vibesboard/adapter-postgres/schema'
import { createJob, getJob } from '../hook-jobs.ts'

async function seedHook(adminDb: any) {
  const u = randomUUID(),
    t = randomUUID(),
    a = randomUUID(),
    h = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'Agent',
    slug: `ag-${a.slice(0, 8)}`
  })
  await adminDb
    .insert(hooks)
    .values({ id: h, tenantId: t, agentId: a, name: 'H', secretHash: 'x' })
  return { tenantId: t, agentId: a, hookId: h }
}

describe('hook-jobs storage (postgres)', () => {
  it('createJob persists pending job; getJob round-trips', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, hookId } = await seedHook(adminDb)
      const job = await createJob(
        {
          hookId,
          agentId,
          tenantId,
          message: 'hi',
          callbackUrl: 'https://example.com/cb',
          externalUserId: 'ext1'
        },
        adminDb
      )
      expect(job.status).toBe('pending')
      expect(job.callbackAttempts).toBe(0)
      const fetched = await getJob(tenantId, agentId, hookId, job.id, adminDb)
      expect(fetched?.message).toBe('hi')
      expect(fetched?.callbackUrl).toBe('https://example.com/cb')
      expect(fetched?.externalUserId).toBe('ext1')
    })
  })

  it('getJob returns null for an unknown job id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, hookId } = await seedHook(adminDb)
      const fetched = await getJob(
        tenantId,
        agentId,
        hookId,
        randomUUID(),
        adminDb
      )
      expect(fetched).toBe(null)
    })
  })
})

describe('hook-jobs storage edge cases (postgres)', () => {
  it('createJob maps optional fields: omitted externalUserId/conversationId become undefined', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, hookId } = await seedHook(adminDb)
      const job = await createJob(
        { hookId, agentId, tenantId, message: 'm', callbackUrl: 'https://example.com/cb' },
        adminDb
      )
      // rowToHookJob collapses null DB columns to undefined
      expect(job.externalUserId).toBe(undefined)
      expect(job.conversationId).toBe(undefined)
      expect(job.reply).toBe(undefined)
      expect(job.error).toBe(undefined)
      expect(job.callbackStatus).toBe(undefined)
      expect(typeof job.createdAt).toBe('string')
    })
  })

  it('createJob persists conversationId when provided', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, hookId } = await seedHook(adminDb)
      const convId = randomUUID()
      const job = await createJob(
        {
          hookId,
          agentId,
          tenantId,
          message: 'm',
          callbackUrl: 'https://example.com/cb',
          conversationId: convId
        },
        adminDb
      )
      const fetched = await getJob(tenantId, agentId, hookId, job.id, adminDb)
      expect(fetched?.conversationId).toBe(convId)
    })
  })

  it('getJob is scoped by tenant + agent + hook (cross-tenant isolation)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedHook(adminDb)
      const b = await seedHook(adminDb)
      const job = await createJob(
        { hookId: a.hookId, agentId: a.agentId, tenantId: a.tenantId, message: 'm', callbackUrl: 'https://example.com/cb' },
        adminDb
      )
      // tenant B cannot read tenant A's job through the scoped lookup
      expect(await getJob(b.tenantId, b.agentId, b.hookId, job.id, adminDb)).toBe(null)
      // correct tenant but wrong hook also fails
      expect(await getJob(a.tenantId, a.agentId, b.hookId, job.id, adminDb)).toBe(null)
      // fully correct scope succeeds
      expect((await getJob(a.tenantId, a.agentId, a.hookId, job.id, adminDb))?.id).toBe(job.id)
    })
  })
})
