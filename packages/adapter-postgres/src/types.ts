// Re-export inferred row/insert types from every schema module so consumers
// can do `import type { Message } from '@vibesboard/adapter-postgres/types'`
// without learning Drizzle's `$inferSelect` ceremony.
export type {
  User,
  NewUser,
  Session,
} from './schema/users.ts'
export type {
  Tenant,
  NewTenant,
  TenantMember,
  Invitation,
} from './schema/tenants.ts'
export type {
  Agent,
  NewAgent,
  AgentLink,
  Hook,
  HookJob,
} from './schema/agents.ts'
export type {
  Conversation,
  NewConversation,
  Message,
  NewMessage,
  ConversationFeedbackRow,
  Notification,
} from './schema/conversations.ts'
export type { File, NewFile } from './schema/files.ts'
export type { Embedding, NewEmbedding } from './schema/vectors.ts'
export type {
  CalendarConnection,
  Booking,
  BookingEnquiry,
} from './schema/scheduling.ts'
export type {
  WhatsappAccount,
  WhatsappConversation,
  WhatsappMessage,
  InstagramAccount,
  InstagramConversation,
  InstagramMessage,
  ChatwootConnection,
} from './schema/channels.ts'
export type {
  FeatureFlag,
  TenantFeatureToggle,
  UsageCounter,
} from './schema/policy.ts'
export type { DataConnection, DataActionLog } from './schema/data.ts'
export type { TenantBranding, PlatformBranding } from './schema/branding.ts'

export type { TenantContext } from './tenant-context.ts'
