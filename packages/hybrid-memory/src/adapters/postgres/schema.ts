import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  real,
  jsonb,
  timestamp,
  index,
  customType,
} from 'drizzle-orm/pg-core'

// pgvector type — mirrors the existing vectors schema in adapter-postgres
const vector = customType<{ data: number[]; driverData: string; config: { dimensions?: number } }>({
  dataType(config?: { dimensions?: number }) {
    return config?.dimensions ? `vector(${config.dimensions})` : 'vector'
  },
  toDriver(val: number[]) {
    return `[${val.join(',')}]`
  },
  fromDriver(val: string) {
    return val
      .slice(1, -1)
      .split(',')
      .map(Number)
  },
})

// ─── Memories ─────────────────────────────────────────────────────────────────

export const hybridMemories = pgTable(
  'hybrid_memories',
  {
    id: uuid('id').primaryKey(),
    scopeId: text('scope_id').notNull(),
    subScopeId: text('sub_scope_id'),
    scope: text('scope', { enum: ['org', 'member'] }).notNull(),

    // Tree navigation
    key: text('key').notNull(),
    description: text('description').notNull().default(''),

    // Content
    content: text('content').notNull(),
    category: text('category', { enum: ['fact', 'preference', 'skill', 'episode', 'context', 'procedure'] }).notNull(),

    // Retrieval class
    presenceClass: text('presence_class', { enum: ['omnipresent', 'pattern', 'on-demand'] }).notNull(),
    triggerPatterns: jsonb('trigger_patterns').$type<string[]>().notNull().default([]),

    // Scoring (from simple-engram)
    importance: real('importance').notNull().default(0.5),
    surprise: real('surprise').notNull().default(0),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessed: timestamp('last_accessed', { withTimezone: true }).notNull().defaultNow(),

    // Versioning
    version: integer('version').notNull().default(1),
    history: jsonb('history').$type<Array<{ content: string; changedAt: string }>>().default([]),

    // Vector embedding (1536 = text-embedding-3-small)
    embedding: vector('embedding', { dimensions: 1536 }),

    // Lifecycle
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byScopeId: index('hybrid_memories_scope_idx').on(t.scopeId),
    byKey: index('hybrid_memories_key_idx').on(t.scopeId, t.key),
    byPresence: index('hybrid_memories_presence_idx').on(t.scopeId, t.presenceClass),
  }),
)

// ─── Observations ─────────────────────────────────────────────────────────────

export const hybridObservations = pgTable(
  'hybrid_observations',
  {
    id: uuid('id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    scopeId: text('scope_id').notNull(),
    subScopeId: text('sub_scope_id'),

    statement: text('statement').notNull(),
    statementEmbedding: vector('statement_embedding', { dimensions: 1536 }),
    evidence: text('evidence').notNull(),
    evidenceEmbedding: vector('evidence_embedding', { dimensions: 1536 }),

    status: text('status', { enum: ['new', 'deferred', 'consolidated', 'discarded'] })
      .notNull()
      .default('new'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byScopeStatus: index('hybrid_observations_scope_status_idx').on(t.scopeId, t.status),
    byConversation: index('hybrid_observations_conv_idx').on(t.conversationId),
  }),
)

// ─── Message embeddings (indiscriminate capture) ──────────────────────────────

export const hybridMessageEmbeddings = pgTable(
  'hybrid_message_embeddings',
  {
    messageId: text('message_id').primaryKey(),
    conversationId: text('conversation_id').notNull(),
    scopeId: text('scope_id').notNull(),
    subScopeId: text('sub_scope_id'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byConversation: index('hybrid_msg_emb_conv_idx').on(t.conversationId),
    byScopeId: index('hybrid_msg_emb_scope_idx').on(t.scopeId),
  }),
)

// ─── Processed conversations (Stage 1 tracking) ───────────────────────────────

export const hybridProcessedConversations = pgTable('hybrid_processed_conversations', {
  conversationId: text('conversation_id').primaryKey(),
  scopeId: text('scope_id').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Mutations (approval queue) ───────────────────────────────────────────────

export const hybridMutations = pgTable(
  'hybrid_mutations',
  {
    id: uuid('id').primaryKey(),
    scopeId: text('scope_id').notNull(),
    subScopeId: text('sub_scope_id'),
    mutation: jsonb('mutation').notNull(),
    approver: text('approver', { enum: ['member', 'org-admin'] }).notNull(),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] })
      .notNull()
      .default('pending'),
    sourceObservationIds: jsonb('source_observation_ids').$type<string[]>().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    byScopeStatus: index('hybrid_mutations_scope_status_idx').on(t.scopeId, t.status),
  }),
)
