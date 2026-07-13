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
ALTER TABLE "embeddings" ALTER COLUMN "embedding" SET DATA TYPE vector(768);--> statement-breakpoint
ALTER TABLE "embeddings_1536" ADD CONSTRAINT "embeddings_1536_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_1536_tenant_src_idx" ON "embeddings_1536" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "embeddings_1536_hnsw_idx" ON "embeddings_1536" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "embeddings_1536_tsv_idx" ON "embeddings_1536" USING gin ("content_tsv");