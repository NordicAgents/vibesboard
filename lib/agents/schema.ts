import { z } from 'zod'

import { BUILTIN_AGENT_TOOLS } from './db'

const builtinToolIds = Object.keys(BUILTIN_AGENT_TOOLS) as [
  keyof typeof BUILTIN_AGENT_TOOLS,
  ...(keyof typeof BUILTIN_AGENT_TOOLS)[]
]

const builtinToolTypeSchema = z.enum(builtinToolIds)

export const agentToolSchema = z.object({
  id: z.string(),
  type: builtinToolTypeSchema,
  name: z.string().optional(),
  description: z.string().optional(),
  config: z.record(z.any()).optional()
})

export const agentModeSchema = z.enum(['provider', 'collector'])

export const collectionFieldSchema = z.object({
  id: z.string(),
  label: z.string().min(1).max(100),
  type: z.enum(['text', 'email', 'phone', 'number', 'long_text', 'choice']),
  required: z.boolean().default(true),
  description: z.string().max(200).optional(),
  choices: z.array(z.string()).optional(),
  order: z.number().int().min(0)
})

export const notificationEventSchema = z.enum(['completed', 'handoff', 'agent_handoff'])

export const notificationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  events: z.array(notificationEventSchema).default(['completed', 'handoff']),
  inApp: z.object({
    enabled: z.boolean().default(true)
  }).default({}),
  email: z.object({
    enabled: z.boolean().default(false),
    address: z.string().email().nullable().optional()
  }).default({}),
  webhook: z.object({
    enabled: z.boolean().default(false),
    url: z.string().url().nullable().optional(),
    secret: z.string().nullable().optional()
  }).default({})
})

export const upsertAgentSchema = z.object({
  name: z.string().min(2).max(120),
  instructions: z.string().min(10).max(20_000),
  fileKeys: z.array(z.string()).default([]),
  tools: z.array(agentToolSchema).default([]),
  allowAnonymous: z.boolean().default(true),
  greetingText: z.string().nullable().optional(),
  mode: agentModeSchema.default('provider'),
  maxResponses: z.number().int().min(1).max(500).nullable().optional(),
  maxAgentResponses: z.number().int().min(1).max(100000).nullable().optional(),
  quickSuggestionsMode: z.enum(['off', 'smart', 'always']).default('smart'),
  quickSuggestionsCount: z.number().int().min(1).max(5).default(4),
  sourceUrls: z.array(z.string().url()).default([]),
  domain: z.string().max(100).regex(/^[a-zA-Z0-9\s,.'&\-()/]+$/, 'Invalid characters in domain').nullable().optional(),
  googleReviewEnabled: z.boolean().default(false),
  googlePlaceId: z.string().nullable().optional(),
  retrievalStrategy: z.enum(['direct', 'rag', 'bash']).default('direct'),
  notificationConfig: notificationConfigSchema.optional(),
  handoffTargets: z.array(z.string()).default([]),
  collectionFields: z.array(collectionFieldSchema).max(20).default([])
})

export const patchAgentSchema = upsertAgentSchema.partial()

export const agentChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().max(2_000)
})

export const agentChatRequestSchema = z.object({
  messages: z.array(agentChatMessageSchema).max(100),
  conversationId: z.string().min(1).optional(),
  handoffAgentId: z.string().min(1).optional()
})

export const publicAgentChatRequestSchema = agentChatRequestSchema.extend({
  externalId: z.string().uuid().optional()
})

export const agentAskRequestSchema = z.object({
  // Allow any non-empty question; frontend already trims/blocks empty input
  question: z.string().min(1).max(2_000),
  contextConversationId: z.string().min(1).optional(),
  sessionId: z.string().uuid().optional()
})
