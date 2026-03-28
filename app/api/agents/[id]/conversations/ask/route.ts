import { NextRequest, NextResponse } from 'next/server'
import { Configuration, OpenAIApi } from 'openai-edge'
import { OpenAIStream, StreamingTextResponse } from 'ai'

import { requireAuth } from '@/lib/firebase/route-handler'
import { getAgentById } from '@/lib/agents/server'
import { agentAskRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { nanoid } from '@/lib/utils'
import { summarizeConversation } from '@/lib/agent/summarize'
import { buildAskAiConversationContext } from '@/lib/agent/conversation-rag'
import { OPENAI_CHAT_MODEL, isResponsesModel, streamText } from '@/lib/openai'
import { canEditAgent } from '@/lib/agents/permissions'
import { checkUsageLimit, recordUsage, usageLimitResponse } from '@/lib/usage'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

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

Conversation snippets:
${context?.trim() ? context : 'No conversation snippets available.'}`

  const model = OPENAI_CHAT_MODEL

  if (isResponsesModel(model)) {
    const prompt = `${systemPrompt}\n\nUser question:\n${payload.question}`
    const stream = await streamText({
      prompt,
      model,
      async onDone(completion) {
        const nextMessages = [
          ...pendingMessages,
          {
            id: nanoid(),
            role: 'assistant' as const,
            content: completion
          }
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
        })
      }
    })

    return new StreamingTextResponse(stream, {
      headers: {
        'x-session-id': askConversation.id
      }
    })
  }

  const response = await openai.createChatCompletion({
    model,
    stream: true,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: payload.question }
    ]
  })

  const stream = OpenAIStream(response, {
    async onCompletion(completion) {
      const nextMessages = [
        ...pendingMessages,
        {
          id: nanoid(),
          role: 'assistant' as const,
          content: completion
        }
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
      })
    }
  })

  return new StreamingTextResponse(stream, {
    headers: {
      'x-session-id': askConversation.id
    }
  })
}
