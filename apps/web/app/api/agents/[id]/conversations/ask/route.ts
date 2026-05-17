import { NextRequest, NextResponse } from 'next/server'
import { streamText as aiStreamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'

import { requireAuth } from '@/lib/firebase/route-handler'
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
  isResponsesModel,
  streamText
} from '@vibesboard/adapter-openai'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response
  const { user } = authResult

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured.' },
      { status: 500 }
    )
  }

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

  const payload = agentAskRequestSchema.parse({
    question:
      typeof json?.question === 'string'
        ? (json.question as string)
        : (json?.prompt as string | undefined),
    contextConversationId: json?.contextConversationId as string | undefined,
    sessionId: json?.sessionId as string | undefined
  })

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

  const saveAndRecord = async (
    completion: string,
    tokenUsage?: { inputTokens?: number; outputTokens?: number }
  ) => {
    const nextMessages = [
      ...pendingMessages,
      { id: nanoid(), role: 'assistant' as const, content: completion }
    ]
    const summary = await summarizeConversation(nextMessages)
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

  const chatMessages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }> = [
    { role: 'system', content: systemPrompt },
    ...existingMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    })),
    { role: 'user', content: payload.question }
  ]

  const openaiClient = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? ''
  })
  const result = await aiStreamText({
    model: openaiClient(model),
    messages: chatMessages,
    temperature: 0.2,
    async onFinish({ text, usage }) {
      await saveAndRecord(text, {
        inputTokens: usage?.promptTokens,
        outputTokens: usage?.completionTokens
      })
    }
  })

  return new Response(result.textStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'x-session-id': askConversation.id
    }
  })
}
