import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { agents } from './agents'

// Global feature definitions
export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),
  defaultValue: boolean('default_value').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// Per-tenant overrides of feature flags
export const tenantFeatureToggles = pgTable(
  'tenant_feature_toggles',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    featureFlagId: uuid('feature_flag_id')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'cascade' }),
    featureFlagName: text('feature_flag_name').notNull(),
    isEnabled: boolean('is_enabled').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('tenant_feature_toggles_pk').on(t.tenantId, t.featureFlagId),
  }),
)

// Simple usage counter (no Stripe coupling). One row per (tenant, agent, month).
// Self-hosters may use this for soft local caps if they want; it is not enforced.
export const usageCounters = pgTable(
  'usage_counters',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    messageCount: integer('message_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('usage_counters_pk').on(t.tenantId, t.agentId, t.periodStart),
    byTenant: index('usage_counters_tenant_idx').on(t.tenantId, t.periodStart),
  }),
)

export type FeatureFlag = typeof featureFlags.$inferSelect
export type TenantFeatureToggle = typeof tenantFeatureToggles.$inferSelect
export type UsageCounter = typeof usageCounters.$inferSelect
