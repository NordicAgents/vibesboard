import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { Configuration, OpenAIApi } from 'openai-edge'
import { OpenAIStream, StreamingTextResponse } from 'ai'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { getAgentForUser } from '@/lib/agents/server'
import { agentAskRequestSchema } from '@/lib/agents/schema'
import { embedTexts } from '@/lib/agent/embeddings'
import {
  ensureConversation,
  listAgentConversations,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { nanoid } from '@/lib/utils'
import { summarizeConversation } from '@/lib/agent/summarize'

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
})

const openai = new OpenAIApi(configuration)

const MAX_MATCHES = 12
const MAX_CONTEXT_CHARS = 12000
const FALLBACK_CONVO_COUNT = 5

export const runtime = 'nodejs'

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
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
    cookies: () => cookieStore
  })

  const agent = await getAgentForUser(supabase, params.id, session.user.id)

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

  let questionEmbedding: number[] | undefined
  try {
    ;[questionEmbedding] = await embedTexts([payload.question])
  } catch (error) {
    console.error('Failed to embed ask question', error)
    return NextResponse.json(
      { error: 'Unable to process question embedding.' },
      { status: 500 }
    )
  }

  let snippets: string[] = []

  if (questionEmbedding) {
    const { data, error } = await supabase.rpc(
      'match_agent_conversation_chunks',
      {
        p_agent_id: agent.id,
        p_query_embedding: questionEmbedding,
        p_match_count: MAX_MATCHES,
        p_conversation_id: payload.contextConversationId ?? null
      }
    )

    if (error) {
      console.error('match_agent_conversation_chunks failed', error)
    } else if (data?.length) {
      let totalChars = 0
      for (const match of data) {
        const snippet = `[cid: ${match.conversation_id} msg: ${match.message_index}] ${match.content}`
        if (totalChars + snippet.length > MAX_CONTEXT_CHARS) {
          break
        }
        snippets.push(snippet)
        totalChars += snippet.length
      }
    }
  }

  if (!snippets.length) {
    const conversations = await listAgentConversations(supabase, agent.id)
    const subset = payload.contextConversationId
      ? conversations.filter(conv => conv.id === payload.contextConversationId)
      : conversations.slice(0, FALLBACK_CONVO_COUNT)

    for (const conversation of subset) {
      if (conversation.summary) {
        snippets.push(`[cid: ${conversation.id} summary] ${conversation.summary}`)
        continue
      }
      const lastMessage = conversation.messages.at(-1)
      if (lastMessage && typeof lastMessage.content === 'string') {
        const content = lastMessage.content.slice(0, 600)
        snippets.push(
          `[cid: ${conversation.id} msg: ${conversation.messages.length - 1}] ${content}`
        )
      }
    }
  }

  const defaultContext =
    snippets.length > 0
      ? snippets.join('\n\n').slice(0, MAX_CONTEXT_CHARS)
      : 'No prior conversations matched this question.'

  const systemPrompt = `You help the owner of agent "${agent.name}" analyze past chats.
Use only the supplied conversation snippets and reference them like (cid: <id> msg: <index>).
If the snippets are insufficient, say so directly. Do not fabricate events.

Snippets:
${defaultContext}`

  const response = await openai.createChatCompletion({
    model: 'gpt-4o-mini',
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
