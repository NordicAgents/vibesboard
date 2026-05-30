import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import {
  replaceFileChunks,
  vectorSearchFileChunks,
  keywordSearchFileChunks,
  deleteFileEmbeddings,
} from '../rag-store.ts'
import {
  insertFiles,
  listFiles,
  setFileStatus,
  getFileById,
  getPendingFiles,
} from '../files-store.ts'

function unitVec(dim: number, hot: number): number[] {
  const v = new Array(dim).fill(0)
  v[hot] = 1
  return v
}

async function seedAgent(adminDb: any) {
  const u = randomUUID()
  const t = randomUUID()
  const a = randomUUID()
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
    .values({ id: a, tenantId: t, userId: u, name: 'A', slug: `a-${a.slice(0, 8)}`, instructions: 'instructions ok' })
  return { tenantId: t, agentId: a, userId: u }
}

describe('files-store', () => {
  it('insert/list/status/pending', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles(
        [{ tenantId, agentId, userId, fileKey: 'k1', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 }],
        adminDb,
      )
      expect(f.status).toBe('pending')
      expect((await getPendingFiles(tenantId, agentId, 10, adminDb)).length).toBe(1)
      await setFileStatus(f.id, 'indexed', {}, adminDb)
      expect((await getFileById(f.id, adminDb))?.status).toBe('indexed')
      const listed = await listFiles({ tenantId, agentId, page: 1, limit: 20 }, adminDb)
      expect(listed.total).toBe(1)
      expect(
        (await listFiles({ tenantId, agentId, status: 'pending', page: 1, limit: 20 }, adminDb)).total,
      ).toBe(0)
    })
  })
})

describe('rag-store vector search', () => {
  it('returns the nearest chunk first (cosine ordering)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles(
        [{ tenantId, agentId, userId, fileKey: 'k', fileName: 'doc.txt', mimeType: 'text/plain', fileSize: 1 }],
        adminDb,
      )
      await replaceFileChunks(
        {
          tenantId,
          fileId: f.id,
          chunks: [
            { chunkIndex: 0, content: 'apples and oranges', embedding: unitVec(1536, 0) },
            { chunkIndex: 1, content: 'database systems', embedding: unitVec(1536, 1) },
            { chunkIndex: 2, content: 'machine learning', embedding: unitVec(1536, 2) },
          ],
        },
        adminDb,
      )
      // Query vector closest to chunk 1 (hot at index 1)
      const res = await vectorSearchFileChunks(
        { tenantId, agentId, queryEmbedding: unitVec(1536, 1), topK: 3 },
        adminDb,
      )
      expect(res.length).toBe(3)
      expect(res[0].chunkIndex).toBe(1) // nearest first
      expect(res[0].fileName).toBe('doc.txt')
      expect(res[0].similarity! > 0.99).toBe(true) // cosine sim ~1 for identical vector
      expect(res[0].similarity! >= res[1].similarity!).toBe(true) // descending similarity
    })
  })

  it('keyword (tsvector) search matches content', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles(
        [{ tenantId, agentId, userId, fileKey: 'k', fileName: 'doc.txt', mimeType: 'text/plain', fileSize: 1 }],
        adminDb,
      )
      await replaceFileChunks(
        {
          tenantId,
          fileId: f.id,
          chunks: [
            { chunkIndex: 0, content: 'the quick brown fox', embedding: unitVec(1536, 0) },
            { chunkIndex: 1, content: 'lazy dogs sleeping', embedding: unitVec(1536, 1) },
          ],
        },
        adminDb,
      )
      const res = await keywordSearchFileChunks({ tenantId, agentId, query: 'fox', topK: 5 }, adminDb)
      expect(res.length).toBe(1)
      expect(res[0].chunkIndex).toBe(0)
    })
  })

  it('replaceFileChunks replaces (not appends) + delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles(
        [{ tenantId, agentId, userId, fileKey: 'k', fileName: 'd.txt', mimeType: 'text/plain', fileSize: 1 }],
        adminDb,
      )
      await replaceFileChunks(
        { tenantId, fileId: f.id, chunks: [{ chunkIndex: 0, content: 'v1', embedding: unitVec(1536, 0) }] },
        adminDb,
      )
      await replaceFileChunks(
        {
          tenantId,
          fileId: f.id,
          chunks: [
            { chunkIndex: 0, content: 'v2', embedding: unitVec(1536, 0) },
            { chunkIndex: 1, content: 'v2b', embedding: unitVec(1536, 1) },
          ],
        },
        adminDb,
      )
      expect(
        (await vectorSearchFileChunks({ tenantId, agentId, queryEmbedding: unitVec(1536, 0), topK: 10 }, adminDb)).length,
      ).toBe(2) // replaced, not 3
      await deleteFileEmbeddings(tenantId, f.id, adminDb)
      expect(
        (await vectorSearchFileChunks({ tenantId, agentId, queryEmbedding: unitVec(1536, 0), topK: 10 }, adminDb)).length,
      ).toBe(0)
    })
  })

  it('vectorSearchFileChunks isolates results by tenant + agent (regression)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const a = await seedAgent(adminDb)
      const b = await seedAgent(adminDb)
      const [fa] = await insertFiles(
        [{ tenantId: a.tenantId, agentId: a.agentId, userId: a.userId, fileKey: 'ka', fileName: 'a.txt', mimeType: 'text/plain', fileSize: 1 }],
        adminDb,
      )
      const [fb] = await insertFiles(
        [{ tenantId: b.tenantId, agentId: b.agentId, userId: b.userId, fileKey: 'kb', fileName: 'b.txt', mimeType: 'text/plain', fileSize: 1 }],
        adminDb,
      )
      await replaceFileChunks(
        { tenantId: a.tenantId, fileId: fa.id, chunks: [{ chunkIndex: 0, content: 'tenant A secret', embedding: unitVec(1536, 0) }] },
        adminDb,
      )
      await replaceFileChunks(
        { tenantId: b.tenantId, fileId: fb.id, chunks: [{ chunkIndex: 0, content: 'tenant B secret', embedding: unitVec(1536, 0) }] },
        adminDb,
      )

      const resA = await vectorSearchFileChunks(
        { tenantId: a.tenantId, agentId: a.agentId, queryEmbedding: unitVec(1536, 0), topK: 10 },
        adminDb,
      )
      expect(resA.length).toBe(1)
      expect(resA[0].content).toContain('tenant A')
    })
  })
})
