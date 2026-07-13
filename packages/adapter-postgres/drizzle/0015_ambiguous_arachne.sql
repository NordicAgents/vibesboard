CREATE TABLE "tenant_llm_task_configs" (
	"tenant_id" uuid NOT NULL,
	"task" text NOT NULL,
	"config_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_llm_task_configs" ADD CONSTRAINT "tenant_llm_task_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_llm_task_configs" ADD CONSTRAINT "tenant_llm_task_configs_config_id_tenant_llm_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."tenant_llm_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_llm_task_configs_pk" ON "tenant_llm_task_configs" USING btree ("tenant_id","task");