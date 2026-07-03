-- Agent config versioning (spec: docs/superpowers/specs/2026-07-01-agent-config-versioning.md).
-- Hand-written migration (not db:generate — the drizzle snapshot chain in this
-- repo is intentionally hand-maintained for these, cf. 0009). Adds the
-- agents.current_version pointer, the immutable agent_versions snapshot table
-- with its tenant-isolation RLS policy, and backfills a v1 snapshot for every
-- existing agent.

-- 1. Version pointer on agents (v1 exists after backfill below).
ALTER TABLE "agents" ADD COLUMN "current_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint

-- 2. Immutable per-agent config snapshots.
CREATE TABLE "agent_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"config" jsonb NOT NULL,
	"source" text NOT NULL,
	"change_note" text,
	"restored_from" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_versions_agent_version_uq" ON "agent_versions" USING btree ("agent_id","version_no");--> statement-breakpoint
CREATE INDEX "agent_versions_agent_idx" ON "agent_versions" USING btree ("agent_id","version_no" DESC);--> statement-breakpoint
CREATE INDEX "agent_versions_tenant_idx" ON "agent_versions" USING btree ("tenant_id");--> statement-breakpoint

-- 3. RLS: tenant-scoped, standard isolation policy (see 0001_rls_policies /
-- 0006_agent_invite_codes_rls). Versioning helpers write via the BYPASSRLS
-- migrate client; this closes the isolation gap for any RLS-scoped read.
ALTER TABLE "agent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "agent_versions_iso" ON "agent_versions"
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
--> statement-breakpoint

-- 4. Backfill: one v1 snapshot per existing agent. Config keys are camelCase to
-- match toAgentConfigSnapshot() in @vibesboard/agents/versioning (the no-op
-- guard compares these snapshots order-insensitively). created_by = the agent's
-- owner (nullable). Uses gen_random_uuid() for the row id (app inserts use v7).
INSERT INTO "agent_versions" (
	"id", "tenant_id", "agent_id", "version_no", "config", "source", "created_by"
)
SELECT
	gen_random_uuid(),
	a."tenant_id",
	a."id",
	1,
	jsonb_build_object(
		'name', a."name",
		'instructions', a."instructions",
		'mode', a."mode",
		'allowAnonymous', a."allow_anonymous",
		'greetingText', a."greeting_text",
		'quickSuggestionsMode', a."quick_suggestions_mode",
		'quickSuggestionsCount', a."quick_suggestions_count",
		'tools', COALESCE(a."tools", '[]'::jsonb),
		'fileKeys', COALESCE(a."file_keys", '[]'::jsonb),
		'handoffTargets', COALESCE(a."handoff_targets", '[]'::jsonb),
		'collectionFields', a."collection_fields",
		'maxResponses', a."max_responses",
		'maxAgentResponses', a."max_agent_responses",
		'googleReviewEnabled', a."google_review_enabled",
		'googlePlaceId', a."google_place_id",
		'retrievalStrategy', a."retrieval_strategy",
		'schedulingConfig', a."scheduling_config",
		'notificationConfig', a."notification_config",
		'bookingConfig', a."booking_config",
		'dataConfig', a."data_config",
		'calendarAvailabilityConfig', a."calendar_availability_config"
	),
	'backfill',
	a."user_id"
FROM "agents" a;
