#!/usr/bin/env node
/**
 * Seed the feature_flags registry from the canonical FEATURE_FLAG_NAMES list.
 *
 * Why this is needed: the per-tenant toggle path (toggleFeature) and the admin
 * UI key off feature_flags.id. Gating (isFeatureEnabled) works without it —
 * it falls back to FEATURE_FLAG_DEFAULTS — but a tenant admin can't flip a flag
 * that has no registry row. This populates one row per known flag, idempotently.
 *
 * Run after migrations on any fresh database:
 *   bun run db:seed-flags
 */
import { uuidv7 } from "uuidv7";
import { getMigrateDb } from "@vibesboard/adapter-postgres/client";
import * as schema from "@vibesboard/adapter-postgres/schema";
import { FEATURE_FLAG_NAMES, FEATURE_FLAG_DEFAULTS } from "./feature-flags.ts";

/** Short, human-facing descriptions for flags worth explaining; others omit. */
const DESCRIPTIONS: Partial<
  Record<(typeof FEATURE_FLAG_NAMES)[number], string>
> = {
  INBOX: "Shared inbox for inbound messaging channels",
  WHATSAPP_INBOX:
    "Connect WhatsApp Business numbers (requires Meta credentials)",
  INSTAGRAM_INBOX: "Connect Instagram accounts (requires Meta credentials)",
  CHATWOOT: "Chatwoot helpdesk integration",
  CUSTOM_BRANDING: "Customize workspace logo and colors",
  TEAM_COLLABORATION: "Invite teammates to the workspace",
  AGENT_LINKS: "Shareable public links for agents",
  AGENT_HANDOFF: "Hand off conversations to a human",
  AGENT_ACTIONS: "Let agents take actions (calendar, etc.)",
};

export async function seedFeatureFlags(): Promise<{ inserted: number }> {
  const db = getMigrateDb();

  const rows = FEATURE_FLAG_NAMES.map((name) => ({
    id: uuidv7(),
    name,
    description: DESCRIPTIONS[name] ?? null,
    defaultValue: FEATURE_FLAG_DEFAULTS[name] ?? true,
  }));

  // Idempotent: feature_flags.name is unique, so re-runs skip existing rows
  // and never disturb their ids (which tenant_feature_toggles references).
  const result = await db
    .insert(schema.featureFlags)
    .values(rows)
    .onConflictDoNothing({ target: schema.featureFlags.name })
    .returning({ id: schema.featureFlags.id });

  return { inserted: result.length };
}

// Allow running directly as a script.
if (process.argv[1] && process.argv[1].endsWith("seed-flags.ts")) {
  process.env.DATABASE_MIGRATE_URL ??=
    "postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev";
  seedFeatureFlags()
    .then(({ inserted }) => {
      console.log(`[seed-flags] Done. Inserted ${inserted} new flag(s).`);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[seed-flags] Failed:", err);
      process.exit(1);
    });
}
