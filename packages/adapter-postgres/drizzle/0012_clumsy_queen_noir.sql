CREATE TABLE "tenant_llm_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"model_id" text NOT NULL,
	"base_url" text,
	"api_key_encrypted" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "llm_config_id" uuid;
--> statement-breakpoint
ALTER TABLE "tenant_llm_configs" ADD CONSTRAINT "tenant_llm_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "tenant_llm_configs_tenant_idx" ON "tenant_llm_configs" USING btree ("tenant_id");
