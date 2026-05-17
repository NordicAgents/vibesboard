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
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenantSource: index('embeddings_tenant_src_idx').on(
      t.tenantId,
      t.sourceType,
      t.sourceId,
    ),
    hnsw: index('embeddings_hnsw_idx')
      .using('hnsw', t.embedding.op('vector_cosine_ops')),
    tsvIdx: index('embeddings_tsv_idx').using('gin', sql`${t.contentTsv}`),
  }),
)

export type Embedding = typeof embeddings.$inferSelect
export type NewEmbedding = typeof embeddings.$inferInsert
