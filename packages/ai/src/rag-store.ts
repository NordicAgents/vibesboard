import { and, eq, sql, desc } from 'drizzle-orm'
import { cosineDistance } from 'drizzle-orm/sql/functions'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { embeddings, embeddings1536, files } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>
export interface ChunkInput { chunkIndex: number; content: string; embedding: number[] }
export interface RetrievedChunk { fileId: string; fileName: string; fileKey: string; mimeType: string; chunkIndex: number; content: string; similarity: number | null }

// ─── Routing ──────────────────────────────────────────────────────────────────
// openai kind → embeddings_1536 (1536-dim, OpenAI text-embedding-3-small)
// everything else → embeddings (768-dim, nomic-embed-text / Ollama default)

export type EmbeddingProvider = 'openai' | 'other'

function selectTable(provider: EmbeddingProvider) {
  return provider === 'openai' ? embeddings1536 : embeddings
}

/** Infer the embedding table from a vector's length. */
export function providerFromDimension(dim: number): EmbeddingProvider {
  return dim === 1536 ? 'openai' : 'other'
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Replace all file_chunk embeddings for a file (delete + insert). */
export async function replaceFileChunks(
  input: { tenantId: string; fileId: string; chunks: ChunkInput[]; provider?: EmbeddingProvider },
  db: Db = getMigrateDb(),
): Promise<number> {
  const provider = input.provider ?? providerFromDimension(input.chunks[0]?.embedding.length ?? 768)
  const table = selectTable(provider)

  return db.transaction(async (tx) => {
    // Delete from both tables to handle provider switches cleanly
    await tx.delete(embeddings).where(and(eq(embeddings.tenantId, input.tenantId), eq(embeddings.sourceType, 'file_chunk'), eq(embeddings.sourceId, input.fileId)))
    await tx.delete(embeddings1536).where(and(eq(embeddings1536.tenantId, input.tenantId), eq(embeddings1536.sourceType, 'file_chunk'), eq(embeddings1536.sourceId, input.fileId)))
    if (!input.chunks.length) return 0
    await tx.insert(table).values(input.chunks.map((c) => ({
      id: uuidv7(), tenantId: input.tenantId, sourceType: 'file_chunk' as const, sourceId: input.fileId,
      chunkIndex: c.chunkIndex, content: c.content,
      contentTsv: sql`to_tsvector('english', ${c.content})`,
      embedding: c.embedding,
    })))
    return input.chunks.length
  })
}

export async function deleteFileEmbeddings(tenantId: string, fileId: string, db: Db = getMigrateDb()): Promise<void> {
  await Promise.all([
    db.delete(embeddings).where(and(eq(embeddings.tenantId, tenantId), eq(embeddings.sourceType, 'file_chunk'), eq(embeddings.sourceId, fileId))),
    db.delete(embeddings1536).where(and(eq(embeddings1536.tenantId, tenantId), eq(embeddings1536.sourceType, 'file_chunk'), eq(embeddings1536.sourceId, fileId))),
  ])
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Cosine vector search over an agent's file chunks. Routes to the correct table. */
export async function vectorSearchFileChunks(
  opts: { tenantId: string; agentId: string; queryEmbedding: number[]; topK: number; provider?: EmbeddingProvider },
  db: Db = getMigrateDb(),
): Promise<RetrievedChunk[]> {
  const provider = opts.provider ?? providerFromDimension(opts.queryEmbedding.length)
  const table = selectTable(provider)
  const distance = cosineDistance(table.embedding, opts.queryEmbedding)
  const rows = await db.select({
      fileId: files.id, fileName: files.fileName, fileKey: files.fileKey, mimeType: files.mimeType,
      chunkIndex: table.chunkIndex, content: table.content, distance: sql<number>`${distance}`,
    }).from(table)
    .innerJoin(files, eq(files.id, table.sourceId))
    .where(and(eq(table.tenantId, opts.tenantId), eq(table.sourceType, 'file_chunk'), eq(files.agentId, opts.agentId)))
    .orderBy(distance).limit(opts.topK)
  return rows.map((r) => ({ fileId: r.fileId, fileName: r.fileName, fileKey: r.fileKey, mimeType: r.mimeType, chunkIndex: r.chunkIndex, content: r.content, similarity: 1 - Number(r.distance) }))
}

/** Full-text keyword fallback (searches both tables, returns best results). */
export async function keywordSearchFileChunks(
  opts: { tenantId: string; agentId: string; query: string; topK: number },
  db: Db = getMigrateDb(),
): Promise<RetrievedChunk[]> {
  // Keyword search doesn't depend on vector dimension — search both tables and merge
  const searchTable = async (table: typeof embeddings | typeof embeddings1536) => {
    const tsq = sql`plainto_tsquery('english', ${opts.query})`
    const rank = sql<number>`ts_rank(${table.contentTsv}, ${tsq})`
    const rows = await db.select({
        fileId: files.id, fileName: files.fileName, fileKey: files.fileKey, mimeType: files.mimeType,
        chunkIndex: table.chunkIndex, content: table.content, rank,
      }).from(table)
      .innerJoin(files, eq(files.id, table.sourceId))
      .where(and(eq(table.tenantId, opts.tenantId), eq(table.sourceType, 'file_chunk'), eq(files.agentId, opts.agentId), sql`${table.contentTsv} @@ ${tsq}`))
      .orderBy(desc(rank)).limit(opts.topK)
    return rows.map((r) => ({ fileId: r.fileId, fileName: r.fileName, fileKey: r.fileKey, mimeType: r.mimeType, chunkIndex: r.chunkIndex, content: r.content, similarity: null as null }))
  }

  const [r768, r1536] = await Promise.all([searchTable(embeddings), searchTable(embeddings1536)])
  return [...r768, ...r1536]
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, opts.topK)
}
