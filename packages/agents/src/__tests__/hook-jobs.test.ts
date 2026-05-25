import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
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
  test('createJob persists pending job; getJob round-trips', async () => {
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
      assert.equal(job.status, 'pending')
      assert.equal(job.callbackAttempts, 0)
      const fetched = await getJob(tenantId, agentId, hookId, job.id, adminDb)
      assert.equal(fetched?.message, 'hi')
      assert.equal(fetched?.callbackUrl, 'https://example.com/cb')
      assert.equal(fetched?.externalUserId, 'ext1')
    })
  })

  test('getJob returns null for an unknown job id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, hookId } = await seedHook(adminDb)
      const fetched = await getJob(
        tenantId,
        agentId,
        hookId,
        randomUUID(),
        adminDb
      )
      assert.equal(fetched, null)
    })
  })
})
