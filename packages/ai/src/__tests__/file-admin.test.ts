import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { uuidv7 } from 'uuidv7'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents, files } from '@vibesboard/adapter-postgres/schema'
import {
  listFilesForAdmin,
  countFilesByStatus,
  getFilesByIds,
} from '../file-admin.ts'

async function seedAgent(adminDb: any) {
  const u = randomUUID(),
    t = randomUUID(),
    a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false,
  })
  await adminDb.insert(agents).values({
    id: a,
    tenantId: t,
    userId: u,
    name: 'Agent',
    slug: `ag-${a.slice(0, 8)}`,
  })
  return { userId: u, tenantId: t, agentId: a }
}

async function seedFile(
  adminDb: any,
  ctx: { tenantId: string; agentId: string },
  status: 'pending' | 'processing' | 'indexed' | 'failed',
) {
  const id = uuidv7()
  await adminDb.insert(files).values({
    id,
    tenantId: ctx.tenantId,
    agentId: ctx.agentId,
    userId: null,
    fileKey: `k/${id}`,
    fileName: `${id}.txt`,
    mimeType: 'text/plain',
    fileSize: 10,
    status,
  })
  return id
}

describe('file-admin (postgres)', () => {
  test('listFilesForAdmin filters by status and agent; countFilesByStatus tallies', async () => {
    await withTestDb(async ({ adminDb }) => {
      const ctx = await seedAgent(adminDb)
      const other = await seedAgent(adminDb)
      await seedFile(adminDb, ctx, 'pending')
      await seedFile(adminDb, ctx, 'pending')
      await seedFile(adminDb, ctx, 'failed')
      await seedFile(adminDb, other, 'indexed')

      const all = await listFilesForAdmin({ limit: 50 }, adminDb)
      assert.equal(all.length, 4)

      const pending = await listFilesForAdmin(
        { status: 'pending', limit: 50 },
        adminDb,
      )
      assert.equal(pending.length, 2)

      const byAgent = await listFilesForAdmin(
        { agentId: ctx.agentId, limit: 50 },
        adminDb,
      )
      assert.equal(byAgent.length, 3)

      const counts = await countFilesByStatus(adminDb)
      assert.equal(counts.total, 4)
      assert.equal(counts.pending, 2)
      assert.equal(counts.failed, 1)
      assert.equal(counts.indexed, 1)
      assert.equal(counts.processing, 0)
    })
  })

  test('getFilesByIds returns only the requested files', async () => {
    await withTestDb(async ({ adminDb }) => {
      const ctx = await seedAgent(adminDb)
      const a = await seedFile(adminDb, ctx, 'pending')
      const b = await seedFile(adminDb, ctx, 'pending')
      await seedFile(adminDb, ctx, 'pending')

      const got = await getFilesByIds([a, b], adminDb)
      assert.equal(got.length, 2)
      assert.deepEqual(new Set(got.map((f) => f.fileId)), new Set([a, b]))

      assert.equal((await getFilesByIds([], adminDb)).length, 0)
    })
  })
})
