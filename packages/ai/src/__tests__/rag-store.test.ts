import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, tenants, agents } from '@vibesboard/adapter-postgres/schema'
import { replaceFileChunks, vectorSearchFileChunks, keywordSearchFileChunks, deleteFileEmbeddings } from '../rag-store.ts'
import { insertFiles, listFiles, setFileStatus, getFileById, getPendingFiles } from '../files-store.ts'

function unitVec(dim: number, hot: number): number[] { const v = new Array(dim).fill(0); v[hot] = 1; return v }

async function seedAgent(adminDb: any) {
  const u = randomUUID(); const t = randomUUID(); const a = randomUUID()
  await adminDb.insert(users).values({ id: u, email: 'o@a.com', name: 'O' })
  await adminDb.insert(tenants).values({ id: t, name: 'Acme', slug: 'acme', createdBy: u, isPersonal: false })
  await adminDb.insert(agents).values({ id: a, tenantId: t, userId: u, name: 'A', slug: 'a', instructions: 'instructions ok' })
  return { tenantId: t, agentId: a, userId: u }
}

describe('files-store', () => {
  test('insert/list/status/pending', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles([{ tenantId, agentId, userId, fileKey: 'k1', fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 }], adminDb)
      assert.equal(f.status, 'pending')
      assert.equal((await getPendingFiles(tenantId, agentId, 10, adminDb)).length, 1)
      await setFileStatus(f.id, 'indexed', {}, adminDb)
      assert.equal((await getFileById(f.id, adminDb))?.status, 'indexed')
      const listed = await listFiles({ tenantId, agentId, page: 1, limit: 20 }, adminDb)
      assert.equal(listed.total, 1)
      assert.equal((await listFiles({ tenantId, agentId, status: 'pending', page: 1, limit: 20 }, adminDb)).total, 0)
    })
  })
})

describe('rag-store vector search', () => {
  test('returns the nearest chunk first (cosine ordering)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles([{ tenantId, agentId, userId, fileKey: 'k', fileName: 'doc.txt', mimeType: 'text/plain', fileSize: 1 }], adminDb)
      await replaceFileChunks({ tenantId, fileId: f.id, chunks: [
        { chunkIndex: 0, content: 'apples and oranges', embedding: unitVec(1536, 0) },
        { chunkIndex: 1, content: 'database systems', embedding: unitVec(1536, 1) },
        { chunkIndex: 2, content: 'machine learning', embedding: unitVec(1536, 2) },
      ] }, adminDb)
      // Query vector closest to chunk 1 (hot at index 1)
      const res = await vectorSearchFileChunks({ tenantId, agentId, queryEmbedding: unitVec(1536, 1), topK: 3 }, adminDb)
      assert.equal(res.length, 3)
      assert.equal(res[0].chunkIndex, 1) // nearest first
      assert.equal(res[0].fileName, 'doc.txt')
      assert.ok(res[0].similarity! > 0.99) // cosine sim ~1 for identical vector
      assert.ok(res[0].similarity! >= res[1].similarity!) // descending similarity
    })
  })
  test('keyword (tsvector) search matches content', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles([{ tenantId, agentId, userId, fileKey: 'k', fileName: 'doc.txt', mimeType: 'text/plain', fileSize: 1 }], adminDb)
      await replaceFileChunks({ tenantId, fileId: f.id, chunks: [
        { chunkIndex: 0, content: 'the quick brown fox', embedding: unitVec(1536, 0) },
        { chunkIndex: 1, content: 'lazy dogs sleeping', embedding: unitVec(1536, 1) },
      ] }, adminDb)
      const res = await keywordSearchFileChunks({ tenantId, agentId, query: 'fox', topK: 5 }, adminDb)
      assert.equal(res.length, 1)
      assert.equal(res[0].chunkIndex, 0)
    })
  })
  test('replaceFileChunks replaces (not appends) + delete', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId, agentId, userId } = await seedAgent(adminDb)
      const [f] = await insertFiles([{ tenantId, agentId, userId, fileKey: 'k', fileName: 'd.txt', mimeType: 'text/plain', fileSize: 1 }], adminDb)
      await replaceFileChunks({ tenantId, fileId: f.id, chunks: [{ chunkIndex: 0, content: 'v1', embedding: unitVec(1536, 0) }] }, adminDb)
      await replaceFileChunks({ tenantId, fileId: f.id, chunks: [{ chunkIndex: 0, content: 'v2', embedding: unitVec(1536, 0) }, { chunkIndex: 1, content: 'v2b', embedding: unitVec(1536, 1) }] }, adminDb)
      assert.equal((await vectorSearchFileChunks({ tenantId, agentId, queryEmbedding: unitVec(1536, 0), topK: 10 }, adminDb)).length, 2) // replaced, not 3
      await deleteFileEmbeddings(tenantId, f.id, adminDb)
      assert.equal((await vectorSearchFileChunks({ tenantId, agentId, queryEmbedding: unitVec(1536, 0), topK: 10 }, adminDb)).length, 0)
    })
  })
})
