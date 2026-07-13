-- RLS for embeddings_1536 (mirrors the policy on the 768-dim embeddings table)
ALTER TABLE "public"."embeddings_1536" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "embeddings_1536_iso" ON "public"."embeddings_1536"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
--> statement-breakpoint

-- RLS for tenant_llm_task_configs (was in 0015_task_configs_rls.sql which
-- was never journaled and therefore never applied in staging/prod)
ALTER TABLE "public"."tenant_llm_task_configs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'tenant_llm_task_configs'
      AND policyname = 'tenant_llm_task_configs_iso'
  ) THEN
    CREATE POLICY "tenant_llm_task_configs_iso" ON "public"."tenant_llm_task_configs"
      USING (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        OR current_setting('app.is_super_admin', true) = 'true'
      )
      WITH CHECK (
        tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
        OR current_setting('app.is_super_admin', true) = 'true'
      );
  END IF;
END $$;
