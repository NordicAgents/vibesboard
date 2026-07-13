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
import { users } from './users.ts'

type AgentSchedulingConfig = {
  enabled: boolean
  calendarConnectionId: string | null
  defaultDurationMinutes: number
  bufferMinutes: number
  timezone: string
  availableHours: { start: string; end: string }
  availableDays: number[]
  meetingTitleTemplate: string
  meetingDescription?: string
  createMeetLink: boolean
}

type AgentNotificationConfig = {
  enabled: boolean
  events: Array<'completed' | 'handoff' | 'agent_handoff'>
  inApp: { enabled: boolean }
  email: { enabled: boolean; address?: string | null }
  webhook: { enabled: boolean; url?: string | null; secret?: string | null }
}

type AgentBookingConfig = {
  enabled: boolean
  resources: Array<{
    id: string
    name: string
    calendarConnectionId: string
    calendarId: string
    calendarName: string
    timezone: string
  }>
  mode?: 'enquiry' | 'direct'
  eventTitleTemplate?: string
  eventTimeMode?: 'all-day' | 'timed'
  overlapProtection?: boolean
}

type AgentDataConfig = {
  enabled: boolean
  connectionId: string | null
  actions: Array<{
    type: 'append_row' | 'update_row' | 'upsert_row' | 'log_event'
    fieldMappings: Array<{
      sourceField: string
      targetField: string
      type?: 'text' | 'number' | 'boolean' | 'date'
    }>
  }>
}

type AgentCalendarAvailabilityConfig = {
  enabled: boolean
  calendarConnectionId: string | null
  calendarId?: string | null
  resourceName?: string
}

type CollectionField = {
  id: string
  label: string
  type: 'text' | 'email' | 'phone' | 'number' | 'long_text' | 'choice'
  required: boolean
  description?: string
  choices?: string[]
  order: number
}

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    instructions: text('instructions').notNull().default(''),
    mode: text('mode', { enum: ['provider', 'collector'] }).notNull().default('provider'),
    allowAnonymous: boolean('allow_anonymous').notNull().default(false),
    accessPasswordHash: text('access_password_hash'),
    greetingText: text('greeting_text'),
    quickSuggestionsMode: text('quick_suggestions_mode', {
      enum: ['off', 'smart', 'always'],
    })
      .notNull()
      .default('off'),
    quickSuggestionsCount: integer('quick_suggestions_count').notNull().default(0),
    tools: jsonb('tools').$type<string[]>().notNull().default([]),
    fileKeys: jsonb('file_keys').$type<string[]>().notNull().default([]),
    handoffTargets: jsonb('handoff_targets').$type<string[]>().notNull().default([]),
    collectionFields: jsonb('collection_fields').$type<CollectionField[]>(),
    maxResponses: integer('max_responses'),
    maxAgentResponses: integer('max_agent_responses'),
    totalResponseCount: integer('total_response_count').notNull().default(0),
    googleReviewEnabled: boolean('google_review_enabled').notNull().default(false),
    googlePlaceId: text('google_place_id'),
    retrievalStrategy: text('retrieval_strategy', { enum: ['direct', 'rag', 'bash'] }),
    lastEmbeddingsSyncAt: timestamp('last_embeddings_sync_at', { withTimezone: true }),
    schedulingConfig: jsonb('scheduling_config').$type<AgentSchedulingConfig>(),
    notificationConfig: jsonb('notification_config').$type<AgentNotificationConfig>(),
    bookingConfig: jsonb('booking_config').$type<AgentBookingConfig>(),
    dataConfig: jsonb('data_config').$type<AgentDataConfig>(),
    calendarAvailabilityConfig: jsonb('calendar_availability_config').$type<AgentCalendarAvailabilityConfig>(),
    // Optional override: use a specific tenant LLM config instead of the global model.
    // Null → fall through to tenant default → global OPENAI_CHAT_MODEL.
    llmConfigId: uuid('llm_config_id'),
    // versionNo of the agent_versions row the live config currently reflects.
    // Always >= 1 once the row exists (v1 is written at create / backfill).
    currentVersion: integer('current_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueSlug: uniqueIndex('agents_tenant_slug_idx').on(t.tenantId, t.slug),
  }),
)

/**
 * The config fields captured in an agent_versions snapshot — the editorial
 * config subset of `agents`, excluding identity (id/tenant/user/slug), runtime
 * counters (totalResponseCount, lastEmbeddingsSyncAt), the version pointer, the
 * access-password credential (managed separately), and timestamps.
 *
 * This type is the single source of truth for the snapshot shape; the builder
 * lives in `@vibesboard/agents/versioning`.
 */
export type AgentConfigSnapshot = {
  name: string
  instructions: string
  mode: 'provider' | 'collector'
  allowAnonymous: boolean
  greetingText: string | null
  quickSuggestionsMode: 'off' | 'smart' | 'always'
  quickSuggestionsCount: number
  tools: string[]
  fileKeys: string[]
  handoffTargets: string[]
  collectionFields: CollectionField[] | null
  maxResponses: number | null
  maxAgentResponses: number | null
  googleReviewEnabled: boolean
  googlePlaceId: string | null
  retrievalStrategy: 'direct' | 'rag' | 'bash' | null
  schedulingConfig: AgentSchedulingConfig | null
  notificationConfig: AgentNotificationConfig | null
  bookingConfig: AgentBookingConfig | null
  dataConfig: AgentDataConfig | null
  calendarAvailabilityConfig: AgentCalendarAvailabilityConfig | null
}

export type AgentVersionSource =
  | 'create'
  | 'update'
  | 'restore'
  | 'backfill'
  | 'file-sync'
  | 'system'

/**
 * Immutable per-agent config snapshots. One row is written on create (v1) and
 * on every config-changing write (see `@vibesboard/agents/versioning`). History
 * is append-only — restore writes a NEW forward version, never rewrites.
 */
export const agentVersions = pgTable(
  'agent_versions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    versionNo: integer('version_no').notNull(),
    config: jsonb('config').$type<AgentConfigSnapshot>().notNull(),
    source: text('source', {
      enum: ['create', 'update', 'restore', 'backfill', 'file-sync', 'system'],
    }).notNull(),
    changeNote: text('change_note'),
    restoredFrom: integer('restored_from'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    agentVersionUnique: uniqueIndex('agent_versions_agent_version_uq').on(
      t.agentId,
      t.versionNo,
    ),
    byAgent: index('agent_versions_agent_idx').on(t.agentId, t.versionNo.desc()),
    byTenant: index('agent_versions_tenant_idx').on(t.tenantId),
  }),
)

export const agentLinks = pgTable(
  'agent_links',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueSlug: uniqueIndex('agent_links_tenant_slug_idx').on(t.tenantId, t.slug),
    byAgent: index('agent_links_agent_idx').on(t.agentId),
  }),
)

export const hooks = pgTable(
  'hooks',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    secretHash: text('secret_hash').notNull(),
    status: text('status', { enum: ['active', 'inactive'] }).notNull().default('active'),
    requestCount: integer('request_count').notNull().default(0),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('hooks_agent_idx').on(t.agentId),
  }),
)

export const hookJobs = pgTable(
  'hook_jobs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    hookId: uuid('hook_id')
      .notNull()
      .references(() => hooks.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    externalUserId: text('external_user_id'),
    conversationId: uuid('conversation_id'),
    callbackUrl: text('callback_url').notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed'],
    })
      .notNull()
      .default('pending'),
    reply: text('reply'),
    error: text('error'),
    callbackStatus: integer('callback_status'),
    callbackAttempts: integer('callback_attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (t) => ({
    byHook: index('hook_jobs_hook_idx').on(t.hookId, t.createdAt),
    byStatus: index('hook_jobs_status_idx').on(t.status, t.createdAt),
  }),
)

type InviteCodeRedemption = { redeemedAt: string; externalId: string }

export const agentInviteCodes = pgTable(
  'agent_invite_codes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    maxUses: integer('max_uses'),
    usedCount: integer('used_count').notNull().default(0),
    revoked: boolean('revoked').notNull().default(false),
    redemptions: jsonb('redemptions').$type<InviteCodeRedemption[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('agent_invite_codes_agent_idx').on(t.tenantId, t.agentId, t.createdAt),
    byCode: uniqueIndex('agent_invite_codes_code_idx').on(t.tenantId, t.agentId, t.code),
  }),
)

export type Agent = typeof agents.$inferSelect
export type NewAgent = typeof agents.$inferInsert
export type AgentVersion = typeof agentVersions.$inferSelect
export type NewAgentVersion = typeof agentVersions.$inferInsert
export type AgentLink = typeof agentLinks.$inferSelect
export type Hook = typeof hooks.$inferSelect
export type HookJob = typeof hookJobs.$inferSelect
export type AgentInviteCode = typeof agentInviteCodes.$inferSelect
