import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants'
import { agents } from './agents'
import { users } from './users'

type HandoffChainEntry = {
  fromAgentId: string
  fromAgentName: string
  toAgentId: string
  toAgentName: string
  timestamp: string
}

type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
  result?: unknown
}

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    externalId: text('external_id'),
    summary: text('summary'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    summaryGeneratedAt: timestamp('summary_generated_at', { withTimezone: true }),
    summaryResponseCount: integer('summary_response_count'),
    handedOff: boolean('handed_off').notNull().default(false),
    handoffChain: jsonb('handoff_chain').$type<HandoffChainEntry[]>(),
    responseCounts: jsonb('response_counts').$type<Record<string, number>>(),
    activeAgentId: uuid('active_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: ['open', 'resolved', 'snoozed'] })
      .notNull()
      .default('open'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('conversations_agent_idx').on(t.tenantId, t.agentId, t.updatedAt),
    byUser: index('conversations_user_idx').on(t.userId),
    byExternal: index('conversations_external_idx').on(t.externalId),
  }),
)

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system', 'tool'] }).notNull(),
    content: text('content').notNull(),
    toolCalls: jsonb('tool_calls').$type<ToolCall[]>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byConv: index('messages_conv_created_idx').on(t.conversationId, t.createdAt),
  }),
)

export const conversationFeedback = pgTable(
  'conversation_feedback',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    rating: text('rating', { enum: ['positive', 'negative'] }).notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byConv: index('conversation_feedback_conv_idx').on(t.conversationId),
  }),
)

export const notifications = pgTable(
  'notifications',
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
    event: text('event', {
      enum: ['completed', 'handoff', 'agent_handoff'],
    }).notNull(),
    summary: text('summary'),
    read: boolean('read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('notifications_tenant_idx').on(t.tenantId, t.read, t.createdAt),
  }),
)

export type Conversation = typeof conversations.$inferSelect
export type NewConversation = typeof conversations.$inferInsert
export type Message = typeof messages.$inferSelect
export type NewMessage = typeof messages.$inferInsert
export type ConversationFeedbackRow = typeof conversationFeedback.$inferSelect
export type Notification = typeof notifications.$inferSelect
