import { describe, expect, it } from 'vitest'
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
  it('listFilesForAdmin filters by status and agent; countFilesByStatus tallies', async () => {
    await withTestDb(async ({ adminDb }) => {
      const ctx = await seedAgent(adminDb)
      const other = await seedAgent(adminDb)
      await seedFile(adminDb, ctx, 'pending')
      await seedFile(adminDb, ctx, 'pending')
      await seedFile(adminDb, ctx, 'failed')
      await seedFile(adminDb, other, 'indexed')

      const all = await listFilesForAdmin({ limit: 50 }, adminDb)
      expect(all.length).toBe(4)

      const pending = await listFilesForAdmin({ status: 'pending', limit: 50 }, adminDb)
      expect(pending.length).toBe(2)

      const byAgent = await listFilesForAdmin({ agentId: ctx.agentId, limit: 50 }, adminDb)
      expect(byAgent.length).toBe(3)

      const counts = await countFilesByStatus(adminDb)
      expect(counts.total).toBe(4)
      expect(counts.pending).toBe(2)
      expect(counts.failed).toBe(1)
      expect(counts.indexed).toBe(1)
      expect(counts.processing).toBe(0)
    })
  })

  it('getFilesByIds returns only the requested files', async () => {
    await withTestDb(async ({ adminDb }) => {
      const ctx = await seedAgent(adminDb)
      const a = await seedFile(adminDb, ctx, 'pending')
      const b = await seedFile(adminDb, ctx, 'pending')
      await seedFile(adminDb, ctx, 'pending')

      const got = await getFilesByIds([a, b], adminDb)
      expect(got.length).toBe(2)
      expect(new Set(got.map((f) => f.fileId))).toEqual(new Set([a, b]))

      expect((await getFilesByIds([], adminDb)).length).toBe(0)
    })
  })
})
