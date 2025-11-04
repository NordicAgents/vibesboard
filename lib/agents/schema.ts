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

export const upsertAgentSchema = z.object({
  name: z.string().min(2).max(120),
  instructions: z.string().min(10),
  fileKeys: z.array(z.string()).default([]),
  tools: z.array(agentToolSchema).default([]),
  allowAnonymous: z.boolean().default(true)
})

export const patchAgentSchema = upsertAgentSchema.partial()

export const agentChatMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string()
})

export const agentChatRequestSchema = z.object({
  messages: z.array(agentChatMessageSchema),
  conversationId: z.string().uuid().optional()
})

export const publicAgentChatRequestSchema = agentChatRequestSchema.extend({
  externalId: z.string().uuid().optional()
})

export const agentAskRequestSchema = z.object({
  question: z.string().min(4),
  conversationId: z.string().uuid().optional()
})
