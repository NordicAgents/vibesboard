import { z } from 'zod'

import { BUILTIN_AGENT_TOOLS } from './db.ts'

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

export const notificationEventSchema = z.enum([
  'completed',
  'handoff',
  'agent_handoff'
])

export const notificationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  events: z.array(notificationEventSchema).default(['completed', 'handoff']),
  inApp: z
    .object({
      enabled: z.boolean().default(true)
    })
    .default({}),
  email: z
    .object({
      enabled: z.boolean().default(false),
      address: z.string().email().nullable().optional()
    })
    .default({}),
  webhook: z
    .object({
      enabled: z.boolean().default(false),
      url: z.string().url().nullable().optional(),
      secret: z.string().nullable().optional()
    })
    .default({})
})

export const schedulingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    calendarConnectionId: z.string().nullable().default(null),
    defaultDurationMinutes: z.number().int().min(5).max(480).default(30),
    bufferMinutes: z.number().int().min(0).max(120).default(0),
    timezone: z.string().default('UTC'),
    availableHours: z
      .object({
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/)
      })
      .default({ start: '09:00', end: '17:00' }),
    availableDays: z
      .array(z.number().int().min(0).max(6))
      .default([1, 2, 3, 4, 5]),
    meetingTitleTemplate: z.string().max(200).default('Meeting with {{name}}'),
    meetingDescription: z.string().max(1000).optional(),
    createMeetLink: z.boolean().default(true)
  })
  .superRefine((config, ctx) => {
    if (config.enabled && !config.calendarConnectionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Scheduling requires a calendar connection before it can be enabled.',
        path: ['calendarConnectionId']
      })
    }
  })

export const dataFieldMappingSchema = z.object({
  collectionFieldId: z.string(),
  targetColumn: z.string().min(1).max(200)
})

export const dataConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    dataConnectionId: z.string().nullable().default(null),
    fieldMappings: z.array(dataFieldMappingSchema).max(50).default([]),
    autoSubmitOnComplete: z.boolean().default(true),
    updateKeyField: z.string().nullable().optional()
  })
  .superRefine((config, ctx) => {
    if (config.enabled && !config.dataConnectionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Data sync requires a connection before it can be enabled.',
        path: ['dataConnectionId']
      })
    }
  })

export const calendarAvailabilityConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    calendarConnectionId: z.string().nullable().default(null),
    calendarId: z.string().nullable().optional(),
    resourceName: z.string().max(100).optional()
  })
  .superRefine((config, ctx) => {
    if (config.enabled && !config.calendarConnectionId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Availability Only requires a connected calendar before it can be enabled.',
        path: ['calendarConnectionId']
      })
    }

    if (config.enabled && !config.calendarId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Availability Only requires a selected calendar before it can be enabled.',
        path: ['calendarId']
      })
    }
  })

export const bookableResourceSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  calendarConnectionId: z.string(),
  calendarId: z.string(),
  calendarName: z.string(),
  timezone: z.string().default('UTC')
})

export const bookingConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    resources: z.array(bookableResourceSchema).default([]),
    mode: z.enum(['enquiry', 'direct']).default('enquiry'),
    eventTitleTemplate: z
      .string()
      .max(200)
      .default('{guest_name} ({guest_count} guests)'),
    eventTimeMode: z.enum(['all-day', 'timed']).default('all-day'),
    overlapProtection: z.boolean().default(true)
  })
  .superRefine((config, ctx) => {
    if (config.enabled && config.resources.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Simple booking requires at least one bookable resource before it can be enabled.',
        path: ['resources']
      })
    }
  })

export const upsertAgentSchema = z.object({
  name: z.string().min(2).max(120),
  instructions: z.string().min(10).max(20_000),
  fileKeys: z.array(z.string()).default([]),
  tools: z.array(agentToolSchema).default([]),
  allowAnonymous: z.boolean().default(false),
  greetingText: z.string().nullable().optional(),
  mode: agentModeSchema.default('provider'),
  maxResponses: z.number().int().min(1).max(500).nullable().optional(),
  maxAgentResponses: z.number().int().min(1).max(100000).nullable().optional(),
  quickSuggestionsMode: z.enum(['off', 'smart', 'always']).default('smart'),
  quickSuggestionsCount: z.number().int().min(1).max(5).default(4),
  sourceUrls: z.array(z.string().url()).default([]),
  domain: z
    .string()
    .max(100)
    .regex(/^[a-zA-Z0-9\s,.'&\-()/]+$/, 'Invalid characters in domain')
    .nullable()
    .optional(),
  googleReviewEnabled: z.boolean().default(false),
  googlePlaceId: z.string().nullable().optional(),
  retrievalStrategy: z.enum(['direct', 'rag', 'bash']).default('direct'),
  notificationConfig: notificationConfigSchema.optional(),
  handoffTargets: z.array(z.string()).default([]),
  collectionFields: z.array(collectionFieldSchema).max(20).default([]),
  schedulingConfig: schedulingConfigSchema.optional(),
  dataConfig: dataConfigSchema.optional(),
  calendarAvailabilityConfig: calendarAvailabilityConfigSchema.optional(),
  bookingConfig: bookingConfigSchema.optional(),
  memoryEnabled: z.boolean().default(false),
  llmConfigId: z.string().uuid().nullable().optional()
})

export const patchAgentSchema = upsertAgentSchema.partial().extend({
  // Optional free-text note attached to the version this edit creates.
  changeNote: z.string().max(500).optional()
})

export const agentChatMessageSchema = z.object({
  id: z.string().optional(),
  // Only user and assistant turns may come from the client. Accepting a
  // client-supplied `system` (or tool) role would let a caller inject
  // instructions with system authority — on the BYO-LLM path that reaches the
  // provider as a real system message. Server-side system prompts are added
  // separately by the chat route, never through this schema.
  role: z.enum(['user', 'assistant']),
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
  sessionId: z.string().min(1).optional()
})
