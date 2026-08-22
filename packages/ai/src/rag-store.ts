import { and, eq, sql, desc } from 'drizzle-orm'
import { cosineDistance } from 'drizzle-orm/sql/functions'
import { uuidv7 } from 'uuidv7'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { embeddings, embeddings1536, embeddings384, embeddings1024, embeddings2048, files } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>
export interface ChunkInput { chunkIndex: number; content: string; embedding: number[] }
export interface RetrievedChunk { fileId: string; fileName: string; fileKey: string; mimeType: string; chunkIndex: number; content: string; similarity: number | null }

// ─── Routing ──────────────────────────────────────────────────────────────────
// openai kind   → embeddings_1536 (1536-dim, OpenAI text-embedding-3-small)
// e5/maas kind  → embeddings_384  (384-dim,  multilingual-e5-large-instruct-maas, Google Cloud MaaS)
// bge kind      → embeddings_1024 (1024-dim, baai/bge-m3, snowflake/arctic-embed — NVIDIA free tier)
// nemotron kind → embeddings_2048 (2048-dim, nvidia/nemotron-3-embed-1b)
// everything else → embeddings    (768-dim,  nomic-embed-text / Ollama default)

export type EmbeddingProvider = 'openai' | 'e5' | 'bge' | 'nemotron' | 'other'
export type EmbeddingTable = typeof embeddings | typeof embeddings1536 | typeof embeddings384 | typeof embeddings1024 | typeof embeddings2048

/** The embedding table a provider's vectors belong in. Shared by every call site. */
export function selectTable(provider: EmbeddingProvider): EmbeddingTable {
  if (provider === 'openai') return embeddings1536
  if (provider === 'e5') return embeddings384
  if (provider === 'bge') return embeddings1024
  if (provider === 'nemotron') return embeddings2048
  return embeddings
}

/** Every embedding table, for provider-switch cleanup (delete from all, insert into one). */
export const ALL_EMBEDDING_TABLES: EmbeddingTable[] = [embeddings, embeddings1536, embeddings384, embeddings1024, embeddings2048]

/** Infer the embedding table from a vector's length. */
export function providerFromDimension(dim: number): EmbeddingProvider {
  if (dim === 1536) return 'openai'
  if (dim === 384) return 'e5'
  if (dim === 1024) return 'bge'
  if (dim === 2048) return 'nemotron'
  return 'other'
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
    // Delete from every table — handles provider switches, and the target
    // table's own previous rows (otherwise a re-index duplicates every chunk).
    // Iterating ALL_EMBEDDING_TABLES rather than hand-listing so a new width
    // cannot be missed here.
    for (const t of ALL_EMBEDDING_TABLES) {
      await tx.delete(t).where(and(eq(t.tenantId, input.tenantId), eq(t.sourceType, 'file_chunk'), eq(t.sourceId, input.fileId)))
    }
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
  await Promise.all(
    ALL_EMBEDDING_TABLES.map(t =>
      db.delete(t).where(and(eq(t.tenantId, tenantId), eq(t.sourceType, 'file_chunk'), eq(t.sourceId, fileId))),
    ),
  )
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
  // Keyword search doesn't depend on vector dimension — search every table and merge
  const searchTable = async (table: EmbeddingTable) => {
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

  const perTable = await Promise.all(ALL_EMBEDDING_TABLES.map(searchTable))
  return perTable.flat()
    .sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))
    .slice(0, opts.topK)
}
