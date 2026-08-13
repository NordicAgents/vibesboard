import { NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText as aiStreamText, tool, createTextStreamResponse } from 'ai'
import { z } from 'zod'

import { uuidv7 } from 'uuidv7'

import { auth } from '@/auth'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents as agentsTable } from '@vibesboard/adapter-postgres/schema'
import {
  BUILTIN_AGENT_TOOLS,
  createAgentSlug,
  ensureUniqueSlug
} from '@vibesboard/agents/db'
import {
  bookingConfigSchema,
  upsertAgentSchema
} from '@vibesboard/agents/schema'
import { getActiveTenant } from '@/lib/tenant-context'
import {
  OPENAI_BASE_URL,
  OPENAI_CHAT_MODEL,
  isResponsesModel
} from '@vibesboard/adapter-openai'
import { createAgentFilesAndTriggerProcessing } from '@vibesboard/agents/file-processing'
import { fetchUrlContent } from '@vibesboard/ai/fetch-url-content'
import { resolveProviderSpec } from '@vibesboard/ai/tenant-llm-config'
import { buildTenantProviderModel } from '@vibesboard/ai/provider-registry'
import { shouldResolveTenantProvider } from '@vibesboard/ai/provider-routing'
import {
  createDirectBookingDraftConfig,
  resolveAgentCreatorBookingConfig
} from '@vibesboard/agents/booking-defaults'

export const runtime = 'nodejs'

const DEFAULT_AGENT_CREATOR_MODEL = 'gpt-5.4-nano'

type AgentCreatorPayload = ReturnType<typeof upsertAgentSchema.parse>

// Mirrors the Postgres insert shape used by `api/agents/route.ts` POST. The
// legacy `tenantSlug`/`agentUrl`/`sourceUrls` fields are not columns
// (slug + tenant join provide them); `totalResponseCount` defaults to 0.
function buildAgentInsertValues(input: {
  agentId: string
  tenantId: string
  userId: string
  slug: string
  payload: AgentCreatorPayload
  maxResponses: number | null
  maxAgentResponses: number | null
}): typeof agentsTable.$inferInsert {
  const { payload } = input
  return {
    id: input.agentId,
    tenantId: input.tenantId,
    userId: input.userId,
    name: payload.name,
    slug: input.slug,
    instructions: payload.instructions ?? '',
    mode: payload.mode ?? 'provider',
    allowAnonymous: payload.allowAnonymous ?? false,
    greetingText: payload.greetingText ?? null,
    quickSuggestionsMode: payload.quickSuggestionsMode ?? 'smart',
    quickSuggestionsCount: payload.quickSuggestionsCount ?? 4,
    tools: (payload.tools as unknown as string[]) ?? [],
    fileKeys: payload.fileKeys ?? [],
    maxResponses: input.maxResponses,
    maxAgentResponses: input.maxAgentResponses,
    totalResponseCount: 0,
    retrievalStrategy: payload.retrievalStrategy ?? 'direct',
    bookingConfig: payload.bookingConfig ?? null
  }
}

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

  const tenantId = await getActiveTenant(session.user.id)
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY

  const availableTools = Object.values(BUILTIN_AGENT_TOOLS).map(t => ({
    id: t.id,
    name: t.name,
    description: t.description
  }))
  const directBookingDraftConfig = createDirectBookingDraftConfig()

  const systemPrompt = `You are an assistant that helps users create an AI agent through a conversational, step-by-step process.

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
- allowAnonymous (default: false; only enable after the user explicitly asks for a public link or embed)
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
  "retrievalStrategy": "rag"
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

  // ai@7.x: system messages must go in `system`, not in `messages`
  const initialMessages = messageList

  // Resolve the language model: tenant BYO-LLM config → platform OpenAI key.
  // previewToken skips BYO-LLM (same behaviour as agent runtime).
  const tenantSpec = shouldResolveTenantProvider({ tenantId, previewToken })
    ? await resolveProviderSpec(
        tenantId!,
        null,
        undefined,
        'agent_creator'
      ).catch(() => null)
    : null

  let languageModel
  if (tenantSpec && tenantId) {
    languageModel = await buildTenantProviderModel(tenantId, tenantSpec)
  } else {
    if (!apiKey) {
      return NextResponse.json(
        {
          error:
            'No LLM provider configured. Add one in Settings → LLM Providers, or set OPENAI_API_KEY.'
        },
        { status: 500 }
      )
    }
    const modelFromEnv = process.env.OPENAI_AGENT_CREATOR_MODEL?.trim()
    const preferredModel = modelFromEnv?.length
      ? modelFromEnv
      : OPENAI_CHAT_MODEL
    const model = isResponsesModel(preferredModel)
      ? DEFAULT_AGENT_CREATOR_MODEL
      : preferredModel
    // `.chat()` — the bare call resolves to createResponsesModel on
    // @ai-sdk/openai@4, which 404s on gateways that only serve
    // /chat/completions. `model` is non-Responses by construction here.
    languageModel = createOpenAI({ apiKey, baseURL: OPENAI_BASE_URL }).chat(
      model
    )
  }

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

  // Set by the create_agent tool below and appended to the response stream,
  // so delivery of the success marker does not depend on the model echoing
  // a tool result back as text.
  let toolOutcome: string | null = null

  const result = await aiStreamText({
    model: languageModel,
    system: systemPrompt + fileInfoBlock,
    messages: initialMessages as any,
    temperature: 0.2,
    tools: {
      create_agent: tool({
        description:
          'Creates the agent with all collected fields when user confirms.',
        inputSchema: createAgentArgsSchema,
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
            allowAnonymous: args.allowAnonymous ?? false,
            fileKeys: effectiveFileKeys,
            tools: toolsPayload,
            sourceUrls: allDetectedUrls,
            mode: agentMode,
            maxResponses,
            maxAgentResponses,
            quickSuggestionsMode: args.quickSuggestionsMode ?? 'smart',
            quickSuggestionsCount: args.quickSuggestionsCount ?? 4,
            // Default to 'rag' when files are attached so vector search is used.
            // 'direct' loads the full file into context which fails for large files
            // or small-context local models (e.g. Ollama smollm2 = 8k tokens).
            retrievalStrategy:
              args.retrievalStrategy ??
              (args.fileKeys?.length ? 'rag' : 'direct'),
            ...(bookingConfig !== undefined && { bookingConfig })
          })

          const tenantId = await getActiveTenant(session.user.id)
          if (!tenantId) {
            return 'I could not create the agent because no workspace/tenant is available. Please create a tenant/workspace and try again.'
          }

          const slug = await ensureUniqueSlug(
            createAgentSlug(agentPayload.name),
            tenantId
          )
          const agentId = uuidv7()

          try {
            await getMigrateDb()
              .insert(agentsTable)
              .values(
                buildAgentInsertValues({
                  agentId,
                  tenantId,
                  userId: session.user.id,
                  slug,
                  payload: agentPayload,
                  maxResponses,
                  maxAgentResponses
                })
              )
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

          // Also stash it for the response stream. The value returned here is
          // a *tool result*: with a single step and toTextStreamResponse /
          // createTextStreamResponse (text parts only) it never becomes
          // assistant text, so the client — which parses ~~~agentcreated~~~ out
          // of the message in onFinish — was told nothing while the agent was
          // created. See the append below.
          toolOutcome = `Done — your agent is created.\n\n~~~agentupdate\n${JSON.stringify(
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

  // Append the tool outcome after the model's own text. Re-wrapped through the
  // AsyncIterable side (not pipeThrough, which locks the ReadableStream the SDK
  // subscribes to internally).
  const withToolOutcome = (
    source: AsyncIterable<string>
  ): ReadableStream<string> => {
    const iterator = source[Symbol.asyncIterator]()
    let flushed = false
    return new ReadableStream<string>({
      async pull(controller) {
        const { value, done } = await iterator.next()
        if (!done) {
          controller.enqueue(value)
          return
        }
        if (!flushed && toolOutcome) {
          flushed = true
          controller.enqueue(toolOutcome)
          return
        }
        controller.close()
      },
      cancel() {
        iterator.return?.()
      }
    })
  }

  return createTextStreamResponse({
    stream: withToolOutcome(result.textStream)
  })
}
