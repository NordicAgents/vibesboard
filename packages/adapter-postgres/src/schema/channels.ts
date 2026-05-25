import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { tenants } from './tenants.ts'
import { agents } from './agents.ts'
import { users } from './users.ts'
import { conversations } from './conversations.ts'

// ─── WhatsApp ───────────────────────────────────────────────────────────

export const whatsappAccounts = pgTable(
  'whatsapp_inbox_accounts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    wabaId: text('waba_id').notNull(),
    phoneNumberId: text('phone_number_id').notNull(),
    displayPhoneNumber: text('display_phone_number').notNull(),
    businessName: text('business_name').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    status: text('status', { enum: ['active', 'disconnected', 'expired'] })
      .notNull()
      .default('active'),
    connectedBy: uuid('connected_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    webhookSubscribed: boolean('webhook_subscribed').notNull().default(false),
    connectionMethod: text('connection_method', {
      enum: ['oauth', 'api_key', 'byoa'],
    }),
    metaAppId: text('meta_app_id'),
    metaAppSecretEncrypted: text('meta_app_secret_encrypted'),
    webhookVerifyTokenEncrypted: text('webhook_verify_token_encrypted'),
    byoaWebhookUrl: text('byoa_webhook_url'),
    assignedAgentId: uuid('assigned_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    agentAutoReply: boolean('agent_auto_reply').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byPhone: index('whatsapp_accounts_phone_idx').on(t.phoneNumberId),
    byTenant: index('whatsapp_accounts_tenant_idx').on(t.tenantId),
  }),
)

export const whatsappConversations = pgTable(
  'whatsapp_inbox_conversations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => whatsappAccounts.id, { onDelete: 'cascade' }),
    contactPhone: text('contact_phone').notNull(),
    contactName: text('contact_name'),
    contactProfileName: text('contact_profile_name'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text('last_message_preview').notNull().default(''),
    unreadCount: integer('unread_count').notNull().default(0),
    assignedTo: uuid('assigned_to').references(() => users.id, {
      onDelete: 'set null',
    }),
    assignedAgentId: uuid('assigned_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    agentPaused: boolean('agent_paused').notNull().default(false),
    agentHandedOff: boolean('agent_handed_off').notNull().default(false),
    agentConversationId: uuid('agent_conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    status: text('status', {
      enum: ['open', 'resolved', 'snoozed'],
    })
      .notNull()
      .default('open'),
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAccountContact: index('whatsapp_conversations_account_contact_idx').on(
      t.accountId,
      t.contactPhone,
    ),
    byAgent: index('whatsapp_conversations_agent_idx').on(t.assignedAgentId),
    uniqAccountContact: unique('whatsapp_conversations_account_contact_uniq').on(
      t.accountId,
      t.contactPhone,
    ),
  }),
)

export const whatsappMessages = pgTable(
  'whatsapp_inbox_messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: 'cascade' }),
    waMessageId: text('wa_message_id').notNull().unique(),
    fromAddr: text('from_addr').notNull(),
    toAddr: text('to_addr').notNull(),
    type: text('type', {
      enum: ['text', 'image', 'document', 'audio', 'video', 'location', 'contacts'],
    }).notNull(),
    text: text('text'),
    mediaUrl: text('media_url'),
    caption: text('caption'),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    status: text('status', {
      enum: ['received', 'sent', 'delivered', 'read', 'failed'],
    }).notNull(),
    sentBy: text('sent_by'),
    sentByAgentName: text('sent_by_agent_name'),
    timestampOriginal: timestamp('timestamp_original', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byConv: index('whatsapp_messages_conv_idx').on(t.conversationId, t.createdAt),
  }),
)

// ─── Instagram ──────────────────────────────────────────────────────────

export const instagramAccounts = pgTable(
  'instagram_inbox_accounts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    instagramAccountId: text('instagram_account_id').notNull(),
    pageId: text('page_id').notNull(),
    pageName: text('page_name').notNull(),
    instagramUsername: text('instagram_username').notNull(),
    accessTokenEncrypted: text('access_token_encrypted').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    status: text('status', { enum: ['active', 'disconnected', 'expired'] })
      .notNull()
      .default('active'),
    connectedBy: uuid('connected_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    webhookSubscribed: boolean('webhook_subscribed').notNull().default(false),
    metaUserId: text('meta_user_id'),
    connectionMethod: text('connection_method', {
      enum: ['oauth', 'api_key', 'byoa'],
    }),
    metaAppId: text('meta_app_id'),
    metaAppSecretEncrypted: text('meta_app_secret_encrypted'),
    webhookVerifyTokenEncrypted: text('webhook_verify_token_encrypted'),
    byoaWebhookUrl: text('byoa_webhook_url'),
    assignedAgentId: uuid('assigned_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    agentAutoReply: boolean('agent_auto_reply').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTenant: index('instagram_accounts_tenant_idx').on(t.tenantId),
  }),
)

export const instagramConversations = pgTable(
  'instagram_inbox_conversations',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => instagramAccounts.id, { onDelete: 'cascade' }),
    contactIgsid: text('contact_igsid').notNull(),
    contactName: text('contact_name'),
    contactUsername: text('contact_username'),
    contactProfilePic: text('contact_profile_pic'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    lastMessagePreview: text('last_message_preview').notNull().default(''),
    unreadCount: integer('unread_count').notNull().default(0),
    assignedTo: uuid('assigned_to').references(() => users.id, {
      onDelete: 'set null',
    }),
    assignedAgentId: uuid('assigned_agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    agentPaused: boolean('agent_paused').notNull().default(false),
    agentHandedOff: boolean('agent_handed_off').notNull().default(false),
    agentConversationId: uuid('agent_conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    status: text('status', { enum: ['open', 'resolved', 'snoozed'] })
      .notNull()
      .default('open'),
    windowExpiresAt: timestamp('window_expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAccountContact: index('instagram_conversations_account_contact_idx').on(
      t.accountId,
      t.contactIgsid,
    ),
    uniqAccountContact: unique('instagram_conversations_account_contact_uniq').on(
      t.accountId,
      t.contactIgsid,
    ),
  }),
)

export const instagramMessages = pgTable(
  'instagram_inbox_messages',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => instagramConversations.id, { onDelete: 'cascade' }),
    igMessageId: text('ig_message_id').notNull().unique(),
    fromAddr: text('from_addr').notNull(),
    toAddr: text('to_addr').notNull(),
    type: text('type', {
      enum: ['text', 'image', 'video', 'story_mention', 'story_reply', 'media_share'],
    }).notNull(),
    text: text('text'),
    mediaUrl: text('media_url'),
    caption: text('caption'),
    direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
    status: text('status', {
      enum: ['received', 'sent', 'delivered', 'read', 'failed'],
    }).notNull(),
    sentBy: text('sent_by'),
    sentByAgentName: text('sent_by_agent_name'),
    timestampOriginal: timestamp('timestamp_original', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byConv: index('instagram_messages_conv_idx').on(t.conversationId, t.createdAt),
  }),
)

// ─── Chatwoot ───────────────────────────────────────────────────────────

export const chatwootConnections = pgTable(
  'chatwoot_connections',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    chatwootUrl: text('chatwoot_url').notNull(),
    chatwootAccountId: integer('chatwoot_account_id').notNull(),
    chatwootInboxId: integer('chatwoot_inbox_id').notNull(),
    chatwootInboxName: text('chatwoot_inbox_name').notNull(),
    apiTokenEncrypted: text('api_token_encrypted').notNull(),
    chatwootWebhookId: integer('chatwoot_webhook_id'),
    agentBotId: integer('agent_bot_id'),
    agentBotName: text('agent_bot_name'),
    botTokenEncrypted: text('bot_token_encrypted'),
    useAgentBot: boolean('use_agent_bot').notNull().default(false),
    webhookSecretHash: text('webhook_secret_hash').notNull(),
    status: text('status', {
      enum: ['active', 'disconnected', 'error'],
    })
      .notNull()
      .default('active'),
    lastMessageReceivedAt: timestamp('last_message_received_at', { withTimezone: true }),
    totalConversations: integer('total_conversations').notNull().default(0),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    disconnectionReason: text('disconnection_reason'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byAgent: index('chatwoot_connections_agent_idx').on(t.agentId),
  }),
)

export type WhatsappAccount = typeof whatsappAccounts.$inferSelect
export type WhatsappConversation = typeof whatsappConversations.$inferSelect
export type WhatsappMessage = typeof whatsappMessages.$inferSelect
export type InstagramAccount = typeof instagramAccounts.$inferSelect
export type InstagramConversation = typeof instagramConversations.$inferSelect
export type InstagramMessage = typeof instagramMessages.$inferSelect
export type ChatwootConnection = typeof chatwootConnections.$inferSelect
