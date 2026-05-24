import { and, eq, sql, desc } from 'drizzle-orm'
import { cosineDistance } from 'drizzle-orm/sql/functions'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { embeddings, files } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>
export interface ChunkInput { chunkIndex: number; content: string; embedding: number[] }
export interface RetrievedChunk { fileId: string; fileName: string; fileKey: string; mimeType: string; chunkIndex: number; content: string; similarity: number | null }

/** Replace all file_chunk embeddings for a file (delete + insert). content_tsv set from content. */
export async function replaceFileChunks(input: { tenantId: string; fileId: string; chunks: ChunkInput[] }, db: Db = getMigrateDb()): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.delete(embeddings).where(and(eq(embeddings.tenantId, input.tenantId), eq(embeddings.sourceType, 'file_chunk'), eq(embeddings.sourceId, input.fileId)))
    if (!input.chunks.length) return 0
    await tx.insert(embeddings).values(input.chunks.map((c) => ({
      id: uuidv7(), tenantId: input.tenantId, sourceType: 'file_chunk' as const, sourceId: input.fileId,
      chunkIndex: c.chunkIndex, content: c.content,
      contentTsv: sql`to_tsvector('english', ${c.content})`,
      embedding: c.embedding,
    })))
    return input.chunks.length
  })
}

export async function deleteFileEmbeddings(tenantId: string, fileId: string, db: Db = getMigrateDb()): Promise<void> {
  await db.delete(embeddings).where(and(eq(embeddings.tenantId, tenantId), eq(embeddings.sourceType, 'file_chunk'), eq(embeddings.sourceId, fileId)))
}

/** Cosine vector search over an agent's file chunks (joins files for metadata). */
export async function vectorSearchFileChunks(opts: { tenantId: string; agentId: string; queryEmbedding: number[]; topK: number }, db: Db = getMigrateDb()): Promise<RetrievedChunk[]> {
  const distance = cosineDistance(embeddings.embedding, opts.queryEmbedding)
  const rows = await db.select({
      fileId: files.id, fileName: files.fileName, fileKey: files.fileKey, mimeType: files.mimeType,
      chunkIndex: embeddings.chunkIndex, content: embeddings.content, distance: sql<number>`${distance}`,
    }).from(embeddings)
    .innerJoin(files, eq(files.id, embeddings.sourceId))
    .where(and(eq(embeddings.tenantId, opts.tenantId), eq(embeddings.sourceType, 'file_chunk'), eq(files.agentId, opts.agentId)))
    .orderBy(distance).limit(opts.topK)
  return rows.map((r) => ({ fileId: r.fileId, fileName: r.fileName, fileKey: r.fileKey, mimeType: r.mimeType, chunkIndex: r.chunkIndex, content: r.content, similarity: 1 - Number(r.distance) }))
}

/** Full-text keyword fallback over an agent's file chunks (tsvector). */
export async function keywordSearchFileChunks(opts: { tenantId: string; agentId: string; query: string; topK: number }, db: Db = getMigrateDb()): Promise<RetrievedChunk[]> {
  const tsq = sql`plainto_tsquery('english', ${opts.query})`
  const rank = sql<number>`ts_rank(${embeddings.contentTsv}, ${tsq})`
  const rows = await db.select({
      fileId: files.id, fileName: files.fileName, fileKey: files.fileKey, mimeType: files.mimeType,
      chunkIndex: embeddings.chunkIndex, content: embeddings.content, rank,
    }).from(embeddings)
    .innerJoin(files, eq(files.id, embeddings.sourceId))
    .where(and(eq(embeddings.tenantId, opts.tenantId), eq(embeddings.sourceType, 'file_chunk'), eq(files.agentId, opts.agentId), sql`${embeddings.contentTsv} @@ ${tsq}`))
    .orderBy(desc(rank)).limit(opts.topK)
  return rows.map((r) => ({ fileId: r.fileId, fileName: r.fileName, fileKey: r.fileKey, mimeType: r.mimeType, chunkIndex: r.chunkIndex, content: r.content, similarity: null }))
}
