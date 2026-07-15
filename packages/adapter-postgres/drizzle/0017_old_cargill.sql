CREATE TABLE "embeddings_1536" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_tsv" "tsvector",
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- All rows in "embeddings" up to this point are 1536-dim (OpenAI family) —
-- move them into the new table before narrowing the column, otherwise the
-- ALTER fails with "expected 768 dimensions, not 1536" on any database with
-- existing data (this is why staging deploys failed from Jul 13). Editing
-- this file is safe: the failed migrate transactions rolled back, so no
-- deployed environment has ever applied it; fresh DBs have no rows to move.
INSERT INTO "embeddings_1536" ("id", "tenant_id", "source_type", "source_id", "chunk_index", "content", "content_tsv", "embedding", "created_at")
SELECT "id", "tenant_id", "source_type", "source_id", "chunk_index", "content", "content_tsv", "embedding", "created_at" FROM "embeddings"
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
DELETE FROM "embeddings";--> statement-breakpoint
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
ALTER TABLE "embeddings_1536" ADD CONSTRAINT "embeddings_1536_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_1536_tenant_src_idx" ON "embeddings_1536" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "embeddings_1536_hnsw_idx" ON "embeddings_1536" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embeddings_1536_tsv_idx" ON "embeddings_1536" USING gin ("content_tsv");