import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.ts'
import { agents } from './agents.ts'
import { conversations } from './conversations.ts'
import { users } from './users.ts'

export const dataConnections = pgTable(
  'data_connections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    provider: text('provider', {
      enum: ['google_sheets', 'airtable', 'custom_webhook'],
    }).notNull(),
    name: text('name').notNull(),
    accessTokenEncrypted: text('access_token_encrypted'),
    refreshTokenEncrypted: text('refresh_token_encrypted'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    email: text('email'),
    spreadsheetId: text('spreadsheet_id'),
    sheetName: text('sheet_name'),
    scopes: jsonb('scopes').$type<string[]>(),
    apiTokenEncrypted: text('api_token_encrypted'),
    baseId: text('base_id'),
    tableId: text('table_id'),
    tableName: text('table_name'),
    webhookUrl: text('webhook_url'),
    webhookMethod: text('webhook_method', { enum: ['POST', 'PUT'] }),
    webhookHeaders: jsonb('webhook_headers').$type<Record<string, string>>(),
    status: text('status', {
      enum: ['active', 'disconnected', 'expired'],
    })
      .notNull()
      .default('active'),
    connectedBy: uuid('connected_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('data_connections_tenant_idx').on(t.tenantId),
  }),
)

export const dataActionLogs = pgTable(
  'data_action_logs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => dataConnections.id, { onDelete: 'cascade' }),
    provider: text('provider', {
      enum: ['google_sheets', 'airtable', 'custom_webhook'],
    }).notNull(),
    action: text('action').notNull(),
    status: text('status', { enum: ['success', 'failed'] }).notNull(),
    rowData: jsonb('row_data').$type<Record<string, unknown>>().notNull(),
    externalRef: text('external_ref'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('data_action_logs_agent_idx').on(t.agentId, t.createdAt),
  }),
)

export type DataConnection = typeof dataConnections.$inferSelect
export type DataActionLog = typeof dataActionLogs.$inferSelect
