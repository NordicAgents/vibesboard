import { NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText as aiStreamText, tool } from 'ai'
import { z } from 'zod'

import { auth } from '@/auth'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import {
  BUILTIN_AGENT_TOOLS,
  createAgentSlug,
  ensureUniqueSlug
} from '@vibesboard/agents/db'
import { bookingConfigSchema, upsertAgentSchema } from '@vibesboard/agents/schema'
import { getActiveTenant, getTenantById } from '@/lib/tenant-context'
import { OPENAI_CHAT_MODEL, isResponsesModel } from '@vibesboard/adapter-openai'
import { createAgentFilesAndTriggerProcessing } from '@vibesboard/agents/file-processing'
import { nanoid } from '@vibesboard/utils'
import { fetchUrlContent } from '@vibesboard/ai/fetch-url-content'
import {
  createDirectBookingDraftConfig,
  resolveAgentCreatorBookingConfig
} from '@vibesboard/agents/booking-defaults'

export const runtime = 'nodejs'

const DEFAULT_AGENT_CREATOR_MODEL = 'gpt-5.4-nano'

export async function POST(req: Request) {
  const session = await auth()

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const json = await req.json()
  const {
    messages = [],
    previewToken,
    fileKeys = [],
    fileNames = []
  } = json ?? {}

  const apiKey = previewToken ?? process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured.' },
      { status: 500 }
    )
  }

  const availableTools = Object.values(BUILTIN_AGENT_TOOLS).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description
  }))
  const directBookingDraftConfig = createDirectBookingDraftConfig()

  const systemPrompt = `You are an assistant that helps users create a "VibeAgent" through a conversational, step-by-step process.

**CRITICAL RULE - READ THIS FIRST:**
NEVER call the create_agent function unless the user EXPLICITLY requests creation with phrases like:
- "create it", "create the agent", "yes create", "go ahead and create"
- "make it", "make the agent", "build it"
- "looks good, create", "yes, let's do it", "go ahead"

Phrases that do NOT mean create (DO NOT call create_agent for these):
- "sounds good", "looks good" (without explicitly saying create)
- "maybe", "I think so", "what about..."
- Any question or request for changes
- Simply providing information

Your job is to GATHER information, SUGGEST values, and UPDATE the form preview. Only CREATE when explicitly asked.

**Your Goal:**
Make agent creation easy and delightful. Guide users through understanding their needs before suggesting anything.

**Available Tools:**
${availableTools.map(t => `- ${t.id}: ${t.name} – ${t.description}`).join('\n')}

**Conversational Flow:**

1. **Gather Information First** - Ask 1-2 clarifying questions based on input type:

   If user provides a **website URL**:
   - The website content has been automatically fetched and included in the message
   - Use the fetched content to understand the business/website and suggest a tailored agent
   - Ask: "What should this agent focus on? Customer support, product info, general questions, or something else?"

   If user provides **files**:
   - Acknowledge the uploaded files by name
   - ALWAYS include "builtin:file_search" in the tools when files are uploaded
   - When calling create_agent with files, ALWAYS include the fileKeys parameter
   - Ask: "What kind of questions should this agent help answer based on these files?"

   If user provides a **description**:
   - Ask one follow-up: "What tone should the agent have? Professional, friendly, casual, or something specific?"

2. **Suggest a Complete Draft** - After gathering enough context:
   - Suggest name, instructions, and greeting
   - Include the ~~~agentupdate~~~ block to update the form preview
   - Ask: "Does this look good? Let me know if you'd like any changes, or say 'create it' when you're ready!"

3. **Wait for Explicit Confirmation** - Only call create_agent when user explicitly confirms

**Required fields to collect:**
- name (2-120 chars, friendly and clear)
- instructions (detailed guidance on behavior, tone, and purpose)
- greetingText (warm, welcoming first message users will see)
- allowAnonymous (default: true, ask only if relevant)
- tools (suggest relevant tools based on needs, use tool IDs from the list above)
- quickSuggestionsMode (default: "smart"; options: "off" | "smart" | "always")
- quickSuggestionsCount (default: 4; options: 1–5)
- mode (default: "provider"; options: "provider" | "collector")
- maxResponses (max AI responses per session; optional, null = unlimited)
- maxAgentResponses (max total AI responses across all sessions; optional, null = unlimited)
- retrievalStrategy (default: "direct"; options: "direct" | "rag" | "bash" — use "rag" for large/many files, "bash" for CSV/JSON/YAML structured data, "direct" for small files)
- bookingConfig (optional; use this for resort, room, property, rental, or calendar-based booking managers)

**Booking Manager Setup:**
If the user wants an owner-facing booking manager for rooms, cabins, villas, rentals, resorts, or properties:
- Include bookingConfig in the agentupdate block and create_agent call.
- Use this exact draft config until calendars are connected:
${JSON.stringify(directBookingDraftConfig, null, 2)}
- Explain that the agent will be created with Direct booking setup started, then the owner must open the agent's Actions tab, add each room calendar as a Bookable Resource, and turn on Simple Booking.
- Do NOT invent Google Calendar IDs, connection IDs, or room resources. Leave resources empty until the owner maps real calendars.
- Instructions should say the agent manages availability, new bookings, edits, and cancellations across room calendars.

**IMPORTANT - Form Updates:**
Whenever you suggest values for the agent, include them in a special JSON block like this:

~~~agentupdate
{
  "name": "suggested name",
  "instructions": "suggested instructions",
  "greetingText": "suggested greeting",
  "tools": ["builtin:web_fetch"],
  "quickSuggestionsMode": "smart",
  "quickSuggestionsCount": 4,
  "mode": "provider",
  "maxResponses": null,
  "maxAgentResponses": null,
  "retrievalStrategy": "direct"
}
~~~

When the draft is for resort/property booking management, include "bookingConfig" in that JSON block too.

This lets the UI update the form in real-time. Include this block AFTER your explanation.

**Functions to call:**

1. **create_agent** - ONLY when user explicitly says "create it" or similar
   Parameters: { name: string, instructions: string, greetingText: string, allowAnonymous?: boolean, tools?: string[], fileKeys?: string[], mode?: "provider" | "collector", maxResponses?: number | null, maxAgentResponses?: number | null, quickSuggestionsMode?: "off" | "smart" | "always", quickSuggestionsCount?: 1 | 2 | 3 | 4 | 5, retrievalStrategy?: "direct" | "rag" | "bash", bookingConfig?: object }

**Interaction style:**
- Be conversational and encouraging
- Ask clarifying questions to understand the agent's purpose
- Suggest values and include the agentupdate block so the form updates
- Be brief but helpful
- ALWAYS ask "Does this look good?" and wait for explicit creation request`

  const fileInfoBlock =
    (fileKeys as string[]).length > 0
      ? `\n\n**Uploaded Files:**\nThe user has uploaded ${(fileKeys as string[]).length} file(s):\n${(
          fileNames as Array<{ fileKey: string; name: string }>
        )
          .map(f => `- ${f.name}`)
          .join(
            '\n'
          )}\n\nIMPORTANT: When suggesting the agent configuration, ALWAYS include "builtin:file_search" in the tools array.\nWhen calling create_agent, ALWAYS include the fileKeys parameter with these values: ${JSON.stringify(fileKeys)}`
      : ''

  // Detect URLs in user messages and fetch content for the latest one
  const messageList = Array.isArray(messages) ? messages : []
  const urlRegex = /https?:\/\/[^\s)>\]]+/g

  // Collect all URLs from all user messages (for sourceUrls storage)
  const allDetectedUrls = [
    ...new Set(
      messageList
        .filter((m: any) => m.role === 'user')
        .flatMap((m: any) => m.content?.match(urlRegex) ?? [])
    )
  ].slice(0, 5)

  // Fetch content for URLs in the last user message
  const lastUserMsg = [...messageList]
    .reverse()
    .find((m: any) => m.role === 'user')

  if (lastUserMsg?.content) {
    const urls = (lastUserMsg.content.match(urlRegex) ?? []).slice(0, 3)

    if (urls.length > 0) {
      const results = await Promise.all(
        urls.map((u: string) => fetchUrlContent(u))
      )

      const contentBlocks = results.map(r => {
        if (r.error) {
          return `[Website Content from ${r.url}]\nError: Could not fetch content — ${r.error}`
        }
        return [
          `[Website Content from ${r.url}]`,
          r.title ? `Title: ${r.title}` : null,
          r.description ? `Description: ${r.description}` : null,
          `Content:\n${r.textContent}`
        ]
          .filter(Boolean)
          .join('\n')
      })

      lastUserMsg.content += '\n\n' + contentBlocks.join('\n\n')
    }
  }

  const initialMessages = [
    { role: 'system', content: systemPrompt + fileInfoBlock },
    ...messageList
  ]

  const modelFromEnv = process.env.OPENAI_AGENT_CREATOR_MODEL?.trim()
  const preferredModel = modelFromEnv?.length ? modelFromEnv : OPENAI_CHAT_MODEL
  const model = isResponsesModel(preferredModel)
    ? DEFAULT_AGENT_CREATOR_MODEL
    : preferredModel

  const createAgentArgsSchema = z.object({
    name: z.string().min(2).max(120),
    instructions: z.string().min(10),
    greetingText: z.string().min(1),
    allowAnonymous: z.boolean().optional(),
    mode: z.enum(['provider', 'collector']).optional(),
    maxResponses: z.number().int().min(1).max(500).nullable().optional(),
    maxAgentResponses: z
      .number()
      .int()
      .min(1)
      .max(100000)
      .nullable()
      .optional(),
    quickSuggestionsMode: z.enum(['off', 'smart', 'always']).optional(),
    quickSuggestionsCount: z.number().int().min(1).max(5).optional(),
    tools: z.array(z.string()).optional(),
    fileKeys: z.array(z.string()).optional(),
    retrievalStrategy: z.enum(['direct', 'rag', 'bash']).optional(),
    bookingConfig: bookingConfigSchema.optional()
  })

  const openaiClient = createOpenAI({ apiKey })

  const result = await aiStreamText({
    model: openaiClient(model),
    messages: initialMessages as any,
    temperature: 0.2,
    tools: {
      create_agent: tool({
        description:
          'Creates the agent with all collected fields when user confirms.',
        parameters: createAgentArgsSchema,
        async execute(args) {
          const effectiveFileKeys = (
            args.fileKeys?.length ? args.fileKeys : fileKeys
          ) as string[]
          const sanitizedToolIds = (args.tools ?? []).filter(
            (toolId): toolId is keyof typeof BUILTIN_AGENT_TOOLS =>
              toolId in BUILTIN_AGENT_TOOLS
          )

          if (
            effectiveFileKeys.length > 0 &&
            !sanitizedToolIds.includes(
              'builtin:file_search' as keyof typeof BUILTIN_AGENT_TOOLS
            )
          ) {
            sanitizedToolIds.push(
              'builtin:file_search' as keyof typeof BUILTIN_AGENT_TOOLS
            )
          }

          const toolsPayload = sanitizedToolIds.map(toolId => ({
            id: toolId,
            type: toolId,
            name: BUILTIN_AGENT_TOOLS[toolId].name,
            description: BUILTIN_AGENT_TOOLS[toolId].description
          }))

          const agentMode = args.mode ?? 'provider'
          const maxResponses = args.maxResponses ?? null
          const maxAgentResponses = args.maxAgentResponses ?? null
          const bookingConfig = resolveAgentCreatorBookingConfig({
            name: args.name,
            instructions: args.instructions,
            greetingText: args.greetingText,
            bookingConfig: args.bookingConfig
          })

          const agentPayload = upsertAgentSchema.parse({
            name: args.name,
            instructions: args.instructions,
            greetingText: args.greetingText,
            allowAnonymous: args.allowAnonymous ?? true,
            fileKeys: effectiveFileKeys,
            tools: toolsPayload,
            sourceUrls: allDetectedUrls,
            mode: agentMode,
            maxResponses,
            maxAgentResponses,
            quickSuggestionsMode: args.quickSuggestionsMode ?? 'smart',
            quickSuggestionsCount: args.quickSuggestionsCount ?? 4,
            retrievalStrategy: args.retrievalStrategy ?? 'direct',
            ...(bookingConfig !== undefined && { bookingConfig })
          })

          const tenantId = await getActiveTenant(session.user.id)
          if (!tenantId) {
            return 'I could not create the agent because no workspace/tenant is available. Please create a tenant/workspace and try again.'
          }

          const tenant = await getTenantById(tenantId)
          const tenantSlug = tenant?.slug ?? 'unknown'
          const slug = await ensureUniqueSlug(
            createAgentSlug(agentPayload.name),
            tenantId
          )
          const agentId = nanoid()
          const now = new Date().toISOString()

          try {
            await adminDb
              .collection(Collections.agents(tenantId))
              .doc(agentId)
              .set({
                id: agentId,
                userId: session.user.id,
                tenantId,
                tenantSlug,
                name: agentPayload.name,
                instructions: agentPayload.instructions,
                fileKeys: agentPayload.fileKeys,
                tools: agentPayload.tools,
                allowAnonymous: agentPayload.allowAnonymous,
                agentUrl: slug,
                greetingText: agentPayload.greetingText ?? null,
                mode: agentPayload.mode,
                maxResponses,
                maxAgentResponses,
                totalResponseCount: 0,
                quickSuggestionsMode: agentPayload.quickSuggestionsMode,
                quickSuggestionsCount: agentPayload.quickSuggestionsCount,
                sourceUrls: agentPayload.sourceUrls,
                retrievalStrategy: agentPayload.retrievalStrategy,
                ...(agentPayload.bookingConfig !== undefined && {
                  bookingConfig: agentPayload.bookingConfig
                }),
                createdAt: now,
                updatedAt: now
              })
          } catch (error: any) {
            console.error('Failed to create agent:', error)
            return `I couldn't create the agent automatically (${error?.message ?? 'Unknown error'}). Please click "Create Agent" in the preview panel.`
          }

          if (effectiveFileKeys.length > 0) {
            createAgentFilesAndTriggerProcessing({
              agentId,
              tenantId,
              userId: session.user.id,
              fileKeys: effectiveFileKeys
            }).catch(error => {
              console.error('[Agent Creator] File processing failed:', error)
            })
          }

          return `Done — your agent is created.\n\n~~~agentupdate\n${JSON.stringify(
            {
              name: agentPayload.name,
              instructions: agentPayload.instructions,
              greetingText: agentPayload.greetingText ?? '',
              tools: sanitizedToolIds,
              allowAnonymous: agentPayload.allowAnonymous,
              fileKeys: agentPayload.fileKeys,
              mode: agentPayload.mode,
              maxResponses,
              maxAgentResponses,
              quickSuggestionsMode: agentPayload.quickSuggestionsMode,
              quickSuggestionsCount: agentPayload.quickSuggestionsCount,
              retrievalStrategy: agentPayload.retrievalStrategy,
              ...(agentPayload.bookingConfig !== undefined && {
                bookingConfig: agentPayload.bookingConfig
              })
            },
            null,
            2
          )}\n~~~\n\n~~~agentcreated\n${JSON.stringify({ id: agentId })}\n~~~`
        }
      })
    }
  })

  return result.toTextStreamResponse()
}
