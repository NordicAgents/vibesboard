import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { Configuration, OpenAIApi } from 'openai-edge'
import { OpenAIStream, StreamingTextResponse } from 'ai'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { getAgentForUser } from '@/lib/agents/server'
import { agentAskRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  listAgentConversations,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { nanoid } from '@/lib/utils'
import { summarizeConversation } from '@/lib/agent/summarize'
import { OPENAI_CHAT_MODEL, isResponsesModel, streamText } from '@/lib/openai'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

const MAX_TOTAL_CONTEXT_CHARS = 12000
const MAX_CONVO_CONTEXT_CHARS = 3500
const MAX_MESSAGES_PER_CONVO = 20
const MAX_CONVERSATIONS = 25

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured.' },
      { status: 500 }
    )
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const agent = await getAgentForUser(supabase, id, session.user.id)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
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
    supabase,
    agentId: agent.id,
    conversationId: payload.sessionId,
    userId: session.user.id,
    initialMessages: []
  })

  const existingMessages = askConversation.messages ?? []
  const userMessage = {
    id: nanoid(),
    role: 'user' as const,
    content: payload.question
  }
  const pendingMessages = [...existingMessages, userMessage]

  const conversations = await listAgentConversations(supabase, agent.id)
  const selectedConversations = (payload.contextConversationId
    ? conversations.filter(conv => conv.id === payload.contextConversationId)
    : conversations.slice(0, MAX_CONVERSATIONS))

  const contextBlocks: string[] = []
  let totalChars = 0

  for (const conversation of selectedConversations) {
    if (totalChars >= MAX_TOTAL_CONTEXT_CHARS) {
      break
    }

    const recentMessages = (conversation.messages ?? []).slice(
      -MAX_MESSAGES_PER_CONVO
    )
    const serialized = recentMessages
      .map(
        (message, idx) =>
          `${message.role === 'assistant' ? 'Agent' : 'User'} ${message.id ?? idx
          }: ${typeof message.content === 'string' ? message.content : ''}`
      )
      .join('\n')

    if (!serialized.trim()) {
      continue
    }

    let block = `=== Conversation cid:${conversation.id} ===\n${serialized}`
    if (block.length > MAX_CONVO_CONTEXT_CHARS) {
      block = block.slice(block.length - MAX_CONVO_CONTEXT_CHARS)
    }

    if (totalChars + block.length > MAX_TOTAL_CONTEXT_CHARS) {
      const remaining = MAX_TOTAL_CONTEXT_CHARS - totalChars
      block = block.slice(block.length - remaining)
    }

    contextBlocks.push(block)
    totalChars += block.length
  }

  const defaultContext =
    contextBlocks.length > 0
      ? contextBlocks.join('\n\n')
      : 'No prior conversations available for context.'

  const systemPrompt = `You help the owner of agent "${agent.name}" analyze past chats.
Use only the supplied conversation blocks; do not invent details that are not present.
Prefer more recent conversations when unsure. Reference conversations by their cid.

Conversations:
${defaultContext}`

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
          supabase,
          conversationId: askConversation.id,
          messages: nextMessages,
          summary
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
        supabase,
        conversationId: askConversation.id,
        messages: nextMessages,
        summary
      })
    }
  })

  return new StreamingTextResponse(stream, {
    headers: {
      'x-session-id': askConversation.id
    }
  })
}
