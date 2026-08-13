CREATE TABLE "embeddings_384" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector",
	"embedding" vector(384) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings_384" ADD CONSTRAINT "embeddings_384_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_384_tenant_src_idx" ON "embeddings_384" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "embeddings_384_hnsw_idx" ON "embeddings_384" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embeddings_384_tsv_idx" ON "embeddings_384" USING gin ("content_tsv");--> statement-breakpoint

-- RLS for embeddings_384 (mirrors the policies on embeddings and embeddings_1536).
-- Every public table must have RLS enabled and at least one policy — see the
-- `rls coverage` test in packages/adapter-postgres/src/__tests__/.
ALTER TABLE "public"."embeddings_384" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "embeddings_384_iso" ON "public"."embeddings_384"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );