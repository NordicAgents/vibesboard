CREATE TABLE "embeddings_2048" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector",
	"embedding" vector(2048) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings_2048" ADD CONSTRAINT "embeddings_2048_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_2048_tenant_src_idx" ON "embeddings_2048" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "embeddings_2048_tsv_idx" ON "embeddings_2048" USING gin ("content_tsv");--> statement-breakpoint

-- RLS for embeddings_2048 (mirrors embeddings, embeddings_384, embeddings_1024,
-- embeddings_1536). Every public table must have RLS enabled and at least one
-- policy — see the `rls coverage` test in
-- packages/adapter-postgres/src/__tests__/rls-coverage.test.ts.
--
-- Note: no HNSW index on the embedding column. pgvector 0.8.4 rejects
-- hnsw/ivfflat above 2000 dimensions ("column cannot have more than 2000
-- dimensions for hnsw index"), so cosine search on this table is a sequential
-- scan narrowed by embeddings_2048_tenant_src_idx. Fine for per-agent corpora;
-- prefer a <=2000-dim model (e.g. baai/bge-m3 at 1024) for large knowledge bases.
ALTER TABLE "public"."embeddings_2048" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "embeddings_2048_iso" ON "public"."embeddings_2048"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
