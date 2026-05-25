-- Meta data-deletion request log (Phase 7c).
-- Hand-written migration (not db:generate). Global, NOT tenant-scoped: keyed by
-- Meta's confirmation code. Records the status of a Facebook/GDPR data-deletion
-- callback so the deletion-status endpoint can report progress. Written only via
-- the BYPASSRLS migrate client from the unauthenticated webhook hot path.
CREATE TABLE "public"."meta_data_deletion_requests" (
  "confirmation_code" text PRIMARY KEY NOT NULL,
  "meta_user_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "deleted_accounts" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

-- RLS: this table holds no tenant_id (a Meta user's app-scoped id can span
-- tenants), so there is no tenant-isolation policy. Enable RLS and restrict all
-- access to super admins; the deletion helpers use the BYPASSRLS migrate client.
ALTER TABLE "public"."meta_data_deletion_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meta_data_deletion_requests_super_admin"
  ON "public"."meta_data_deletion_requests"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
