-- Hybrid memory tables — standalone reference migration for external consumers
-- of PostgresHybridStore. Requires the pgvector extension.
--
-- NOTE: within Vibesboard this is NOT the migration that runs — the tables are
-- created by packages/adapter-postgres/drizzle/0020_hybrid_memory_tables.sql,
-- which enables RLS without policies (scope_id holds an agent id there, so the
-- tenant-GUC policies below would never match; access goes through the
-- BYPASSRLS migrate client). The policies below assume scope_id is your tenant
-- id and your app sets the app.current_tenant_id GUC — adapt them if not.

CREATE EXTENSION IF NOT EXISTS vector;

-- ─── Memories ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hybrid_memories (
  id              uuid PRIMARY KEY,
  scope_id        text NOT NULL,
  sub_scope_id    text,
  scope           text NOT NULL CHECK (scope IN ('org', 'member')),
  key             text NOT NULL,
  description     text NOT NULL DEFAULT '',
  content         text NOT NULL,
  category        text NOT NULL CHECK (category IN ('fact', 'preference', 'skill', 'episode', 'context', 'procedure')),
  presence_class  text NOT NULL CHECK (presence_class IN ('omnipresent', 'pattern', 'on-demand')),
  trigger_patterns jsonb NOT NULL DEFAULT '[]',
  importance      real NOT NULL DEFAULT 0.5,
  surprise        real NOT NULL DEFAULT 0,
  access_count    integer NOT NULL DEFAULT 0,
  last_accessed   timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  history         jsonb DEFAULT '[]',
  embedding       vector(1536),
  metadata        jsonb DEFAULT '{}',
  expires_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hybrid_memories_scope_idx    ON hybrid_memories (scope_id);
CREATE INDEX IF NOT EXISTS hybrid_memories_key_idx      ON hybrid_memories (scope_id, key);
CREATE INDEX IF NOT EXISTS hybrid_memories_presence_idx ON hybrid_memories (scope_id, presence_class);
CREATE INDEX IF NOT EXISTS hybrid_memories_hnsw_idx     ON hybrid_memories USING hnsw (embedding vector_cosine_ops);

ALTER TABLE hybrid_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY hybrid_memories_iso ON hybrid_memories
  USING (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- ─── Observations ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hybrid_observations (
  id                   uuid PRIMARY KEY,
  conversation_id      text NOT NULL,
  scope_id             text NOT NULL,
  sub_scope_id         text,
  statement            text NOT NULL,
  statement_embedding  vector(1536),
  evidence             text NOT NULL,
  evidence_embedding   vector(1536),
  status               text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'deferred', 'consolidated', 'discarded')),
  defer_count          integer NOT NULL DEFAULT 0,
  deferred_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hybrid_observations_scope_status_idx ON hybrid_observations (scope_id, status);
CREATE INDEX IF NOT EXISTS hybrid_observations_conv_idx         ON hybrid_observations (conversation_id);

ALTER TABLE hybrid_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY hybrid_observations_iso ON hybrid_observations
  USING (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- ─── Message embeddings (indiscriminate capture) ──────────────────────────────

CREATE TABLE IF NOT EXISTS hybrid_message_embeddings (
  message_id       text PRIMARY KEY,
  conversation_id  text NOT NULL,
  scope_id         text NOT NULL,
  sub_scope_id     text,
  content          text NOT NULL,
  embedding        vector(1536),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hybrid_msg_emb_conv_idx   ON hybrid_message_embeddings (conversation_id);
CREATE INDEX IF NOT EXISTS hybrid_msg_emb_scope_idx  ON hybrid_message_embeddings (scope_id);

ALTER TABLE hybrid_message_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY hybrid_message_embeddings_iso ON hybrid_message_embeddings
  USING (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- ─── Processed conversations (Stage 1 tracking) ───────────────────────────────

CREATE TABLE IF NOT EXISTS hybrid_processed_conversations (
  conversation_id  text PRIMARY KEY,
  scope_id         text NOT NULL,
  processed_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hybrid_processed_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY hybrid_processed_conversations_iso ON hybrid_processed_conversations
  USING (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- ─── Mutations (approval queue) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hybrid_mutations (
  id                     uuid PRIMARY KEY,
  scope_id               text NOT NULL,
  sub_scope_id           text,
  mutation               jsonb NOT NULL,
  approver               text NOT NULL CHECK (approver IN ('member', 'org-admin')),
  status                 text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  source_observation_ids jsonb DEFAULT '[]',
  created_at             timestamptz NOT NULL DEFAULT now(),
  resolved_at            timestamptz
);

CREATE INDEX IF NOT EXISTS hybrid_mutations_scope_status_idx ON hybrid_mutations (scope_id, status);

ALTER TABLE hybrid_mutations ENABLE ROW LEVEL SECURITY;

CREATE POLICY hybrid_mutations_iso ON hybrid_mutations
  USING (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    scope_id = NULLIF(current_setting('app.current_tenant_id', true), '')
    OR current_setting('app.is_super_admin', true) = 'true'
  );
