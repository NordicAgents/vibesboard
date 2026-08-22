-- Hybrid memory tables for @vibesboard/hybrid-memory's PostgresHybridStore.
-- Mirrors packages/hybrid-memory/migrations/001_create_hybrid_tables.sql,
-- adapted for Vibesboard: scope_id holds an AGENT id (not a tenant id), so the
-- standard tenant-GUC policies cannot apply. RLS is enabled with NO policies —
-- the app role (vibesboard_app) is denied outright, and all access goes through
-- the BYPASSRLS migrate client with scoping enforced in @vibesboard/hybrid-memory.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hybrid_memories" (
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_memories_scope_idx    ON hybrid_memories (scope_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_memories_key_idx      ON hybrid_memories (scope_id, key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_memories_presence_idx ON hybrid_memories (scope_id, presence_class);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_memories_hnsw_idx     ON hybrid_memories USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
ALTER TABLE "hybrid_memories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hybrid_observations" (
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_observations_scope_status_idx ON hybrid_observations (scope_id, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_observations_conv_idx         ON hybrid_observations (conversation_id);
--> statement-breakpoint
ALTER TABLE "hybrid_observations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hybrid_message_embeddings" (
  message_id       text PRIMARY KEY,
  conversation_id  text NOT NULL,
  scope_id         text NOT NULL,
  sub_scope_id     text,
  content          text NOT NULL,
  embedding        vector(1536),
  created_at       timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_msg_emb_conv_idx   ON hybrid_message_embeddings (conversation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_msg_emb_scope_idx  ON hybrid_message_embeddings (scope_id);
--> statement-breakpoint
ALTER TABLE "hybrid_message_embeddings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hybrid_processed_conversations" (
  conversation_id  text PRIMARY KEY,
  scope_id         text NOT NULL,
  processed_at     timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "hybrid_processed_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "hybrid_mutations" (
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
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS hybrid_mutations_scope_status_idx ON hybrid_mutations (scope_id, status);
--> statement-breakpoint
ALTER TABLE "hybrid_mutations" ENABLE ROW LEVEL SECURITY;
