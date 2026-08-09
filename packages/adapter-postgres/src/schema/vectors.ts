import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  vector,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { tenants } from './tenants.ts'
import { tsvector } from './custom-types.ts'

// ─── 768-dim embeddings (default) ─────────────────────────────────────────────
// Used by nomic-embed-text (Ollama) and any openai_compatible provider whose
// model produces 768-dimensional vectors.

export const embeddings = pgTable(
  'embeddings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceType: text('source_type', {
      enum: ['file_chunk', 'conversation_chunk'],
    }).notNull(),
    sourceId: uuid('source_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentTsv: tsvector('content_tsv'),
    embedding: vector('embedding', { dimensions: 768 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenantSource: index('embeddings_tenant_src_idx').on(t.tenantId, t.sourceType, t.sourceId),
    hnsw: index('embeddings_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    tsvIdx: index('embeddings_tsv_idx').using('gin', sql`${t.contentTsv}`),
  }),
)

// ─── 1536-dim embeddings (OpenAI family) ──────────────────────────────────────
// Used by openai kind providers (text-embedding-3-small / text-embedding-ada-002).
// Separate table because pgvector requires a fixed dimension per column and
// HNSW indexes cannot span multiple dimensions.

export const embeddings1536 = pgTable(
  'embeddings_1536',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceType: text('source_type', {
      enum: ['file_chunk', 'conversation_chunk'],
    }).notNull(),
    sourceId: uuid('source_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentTsv: tsvector('content_tsv'),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenantSource: index('embeddings_1536_tenant_src_idx').on(t.tenantId, t.sourceType, t.sourceId),
    hnsw: index('embeddings_1536_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    tsvIdx: index('embeddings_1536_tsv_idx').using('gin', sql`${t.contentTsv}`),
  }),
)

// ─── 384-dim embeddings (multilingual-e5-small / MaaS models) ────────────────
// Used by multilingual-e5-small and other 384-dim OpenAI-compatible embedding
// models (e.g. served via Azure AI MaaS, HuggingFace Inference Endpoints, etc.)
// Separate table because pgvector requires a fixed dimension per column.

export const embeddings384 = pgTable(
  'embeddings_384',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceType: text('source_type', {
      enum: ['file_chunk', 'conversation_chunk'],
    }).notNull(),
    sourceId: uuid('source_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    contentTsv: tsvector('content_tsv'),
    embedding: vector('embedding', { dimensions: 384 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenantSource: index('embeddings_384_tenant_src_idx').on(t.tenantId, t.sourceType, t.sourceId),
    hnsw: index('embeddings_384_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops')),
    tsvIdx: index('embeddings_384_tsv_idx').using('gin', sql`${t.contentTsv}`),
  }),
)

export type Embedding = typeof embeddings.$inferSelect
export type NewEmbedding = typeof embeddings.$inferInsert
export type Embedding1536 = typeof embeddings1536.$inferSelect
export type Embedding384 = typeof embeddings384.$inferSelect
