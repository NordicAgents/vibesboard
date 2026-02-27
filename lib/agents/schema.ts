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

export const upsertAgentSchema = z.object({
  name: z.string().min(2).max(120),
  instructions: z.string().min(10),
  fileKeys: z.array(z.string()).default([]),
  tools: z.array(agentToolSchema).default([]),
  allowAnonymous: z.boolean().default(true),
  greetingText: z.string().nullable().optional(),
  mode: agentModeSchema.default('provider'),
  maxMessages: z.number().int().min(1).max(50).nullable().optional(),
  quickSuggestionsMode: z.enum(['off', 'smart', 'always']).default('smart'),
  quickSuggestionsCount: z.number().int().min(3).max(4).default(4)
})

export const patchAgentSchema = upsertAgentSchema.partial()

export const agentChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string()
})

export const agentChatRequestSchema = z.object({
  messages: z.array(agentChatMessageSchema),
  conversationId: z.string().min(1).optional()
})

export const publicAgentChatRequestSchema = agentChatRequestSchema.extend({
  externalId: z.string().uuid().optional()
})

export const agentAskRequestSchema = z.object({
  // Allow any non-empty question; frontend already trims/blocks empty input
  question: z.string().min(1),
  contextConversationId: z.string().min(1).optional(),
  sessionId: z.string().uuid().optional()
})
