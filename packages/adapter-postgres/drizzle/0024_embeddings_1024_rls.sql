-- RLS for embeddings_1024 (mirrors the policies on embeddings, embeddings_384
-- and embeddings_1536).
--
-- 0023_lucky_shatterstar created embeddings_1024 with a tenant_id column but
-- never enabled row-level security on it, so the table was readable across
-- tenants by the (non-BYPASSRLS) app role. Every public table must have RLS
-- enabled and at least one policy — see the `rls coverage` test in
-- packages/adapter-postgres/src/__tests__/rls-coverage.test.ts.
--
-- Shipped as a separate migration rather than an edit to 0023: the migrator
-- keys on the journal's `when`, so amending an already-applied file would
-- leave existing databases un-fixed.
ALTER TABLE "public"."embeddings_1024" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "embeddings_1024_iso" ON "public"."embeddings_1024"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
