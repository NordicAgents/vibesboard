import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.ts'
import { agents } from './agents.ts'

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

// Usage rollup (no Stripe coupling). One row per (tenant, agent, month).
// MONTHLY_MESSAGE_LIMIT optionally enforces a soft workspace cap.
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
    sourceCounts: jsonb('source_counts')
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
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

// Durable counters for anonymous/API request throttling. Identifiers are
// HMACed before storage; this table never stores raw IP addresses or cookies.
// It is accessed only through the BYPASSRLS migration client.
export const requestRateLimits = pgTable(
  'request_rate_limits',
  {
    scope: text('scope').notNull(),
    keyHash: text('key_hash').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    requestCount: integer('request_count').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
  },
  t => ({
    pk: uniqueIndex('request_rate_limits_pk').on(
      t.scope,
      t.keyHash,
      t.windowStart
    ),
    byWindow: index('request_rate_limits_window_idx').on(t.windowStart)
  })
)

export type RequestRateLimit = typeof requestRateLimits.$inferSelect
