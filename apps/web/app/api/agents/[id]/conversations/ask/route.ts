import { NextRequest, NextResponse } from 'next/server'
import { streamText as aiStreamText, createTextStreamResponse } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { agentAskRequestSchema } from '@vibesboard/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@vibesboard/agents/conversations'
import { nanoid } from '@vibesboard/utils'
import { summarizeConversation } from '@vibesboard/ai/summarize'
import { buildAskAiConversationContext } from '@vibesboard/ai/conversation-rag'
import {
  OPENAI_CHAT_MODEL,
  OPENAI_BASE_URL,
  isResponsesModel,
  streamText
} from '@vibesboard/adapter-openai'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'
import { resolveProviderSpec } from '@vibesboard/ai/tenant-llm-config'
import { buildTenantProviderModel } from '@vibesboard/ai/provider-registry'
import { contextWindowForModel } from '@vibesboard/agents/auto-summarize'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const { user } = authResult

  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Check tenant usage limit
  const usageCheck = await checkUsageLimit(agent.tenantId)
  if (!usageCheck.allowed) {
    return usageLimitResponse(usageCheck)
  }

  let json: Record<string, unknown> | null = null
  try {
    json = await req.json()
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // A bare .parse() here threw a ZodError straight out of the handler, which
  // Next surfaces as a 500 — invalid client input is a 400.
  const parsed = agentAskRequestSchema.safeParse({
    question:
      typeof json?.question === 'string'
        ? (json.question as string)
        : (json?.prompt as string | undefined),
    contextConversationId: json?.contextConversationId as string | undefined,
    sessionId: json?.sessionId as string | undefined
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const payload = parsed.data

  const askConversation = await ensureConversation({
    tenantId: agent.tenantId,
    agentId: agent.id,
    conversationId: payload.sessionId,
    userId: user.id,
    initialMessages: []
  })

  const existingMessages = askConversation.messages ?? []
  const userMessage = {
    id: nanoid(),
    role: 'user' as const,
    content: payload.question
  }
  const pendingMessages = [...existingMessages, userMessage]

  const { context } = await buildAskAiConversationContext({
    tenantId: agent.tenantId,
    agentId: agent.id,
    question: payload.question,
    contextConversationId: payload.contextConversationId
  })

  const systemPrompt = `You help the editor of agent "${agent.name}" analyze visitor conversations.
Use only the supplied conversation snippets; do not invent details that are not present.
If the snippets are insufficient, say what is missing and suggest syncing embeddings.

Answer the user's question directly and concisely based on the visitor conversations.

Rules:
- Do NOT mention internal IDs (UUIDs, message IDs, conversation IDs, "cid", database identifiers).
- When referencing a conversation, refer to it by its label (e.g., "Conversation 2") and/or the date/summary shown.
- Quote short phrases from the snippets when helpful.

When the answer involves counts, trends, comparisons, or distributions, include a chart after your text using this exact format:

\`\`\`chart
{"type":"bar","title":"Chart title","labels":["Label1","Label2"],"datasets":[{"label":"Series name","data":[10,20]}]}
\`\`\`

Chart types: "bar" for comparisons, "line" for trends over time, "pie" or "doughnut" for distributions.
Only include a chart when real data from the conversation snippets supports it. Never invent numbers.

Conversation snippets:
${context?.trim() ? context : 'No conversation snippets available.'}`

  const model = OPENAI_CHAT_MODEL
  const tenantSpec = await resolveProviderSpec(agent.tenantId, null, undefined, 'chat').catch(() => null)

  const saveAndRecord = async (
    completion: string,
    tokenUsage?: { inputTokens?: number; outputTokens?: number }
  ) => {
    const nextMessages = [
      ...pendingMessages,
      { id: nanoid(), role: 'assistant' as const, content: completion }
    ]
    // Summarize only when context reaches 50% — same logic as public chat
    const promptTokens = tokenUsage?.inputTokens ?? 0
    const contextWindow = contextWindowForModel(tenantSpec?.modelId ?? '')
    const summary = promptTokens > 0 && promptTokens / contextWindow >= 0.5
      ? await summarizeConversation(nextMessages, agent?.tenantId)
      : null
    await updateConversationMessages({
      tenantId: agent.tenantId,
      agentId: agent.id,
      conversationId: askConversation.id,
      messages: nextMessages,
      summary
    })
    recordUsage({
      tenantId: agent.tenantId,
      agentId: agent.id,
      conversationId: askConversation.id,
      userId: user.id,
      source: 'ask_ai',
      model,
      inputTokens: tokenUsage?.inputTokens,
      outputTokens: tokenUsage?.outputTokens
    })
  }

  // Build conversation history for multi-turn context
  const historyLines = existingMessages
    .map(m => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.content}`)
    .join('\n')
  const historyBlock = historyLines
    ? `\n\nConversation so far:\n${historyLines}\n`
    : ''

  if (isResponsesModel(model)) {
    const prompt = `${systemPrompt}${historyBlock}\n\nUser question:\n${payload.question}`
    const stream = await streamText({
      prompt,
      model,
      async onDone(completion, usage) {
        await saveAndRecord(completion, usage)
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'x-session-id': askConversation.id
      }
    })
  }

  // ai@7.x: system messages must go in `system` (not in `messages` array)
  const chatMessages: Array<{
    role: 'user' | 'assistant'
    content: string
  }> = [
    ...existingMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    })),
    { role: 'user', content: payload.question }
  ]

  const languageModel = tenantSpec
    ? await buildTenantProviderModel(agent.tenantId, tenantSpec)
    : createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? '', baseURL: OPENAI_BASE_URL })(model)
  // See packages/ai/src/runtime.ts: when the response is piped from
  // result.textStream, onFinish's `text` comes back empty — the client gets the
  // reply while the persisted assistant message is "". Accumulate what is
  // actually streamed and prefer it.
  let streamed = ''

  const result = await aiStreamText({
    model: languageModel,
    system: systemPrompt,
    messages: chatMessages,
    temperature: 0.2,
    async onFinish({ text, usage }) {
      await saveAndRecord(text && text.length > 0 ? text : streamed, {
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens
      })
    }
  })

  // Re-wrap through the AsyncIterable side (not pipeThrough, which would lock
  // the ReadableStream the SDK subscribes to internally) so we can observe each
  // chunk while still handing createTextStreamResponse a ReadableStream<string>.
  const tap = (source: AsyncIterable<string>): ReadableStream<string> => {
    const iterator = source[Symbol.asyncIterator]()
    return new ReadableStream<string>({
      async pull(controller) {
        const { value, done } = await iterator.next()
        if (done) {
          controller.close()
          return
        }
        streamed += value
        controller.enqueue(value)
      },
      cancel() {
        iterator.return?.()
      }
    })
  }

  // createTextStreamResponse takes AsyncIterable<string> — this interface is not locked
  // by the SDK's internal subscriptions (unlike ReadableStream which is locked via getReader)
  return createTextStreamResponse({
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'x-session-id': askConversation.id },
    stream: tap(result.textStream),
  })
}
