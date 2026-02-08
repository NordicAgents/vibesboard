import { StreamingTextResponse, type Message } from 'ai'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { getAgentForMember } from '@/lib/agents/server'
import { agentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { fetchAgentFileContext } from '@/lib/agent/rag'
import { runAgentStream } from '@/lib/agent/runtime'
import { nanoid } from '@/lib/utils'
import {
  stripCompletionMarkers,
  wrapStreamWithCompletionDetection
} from '@/lib/agent/completion'

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

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const agent = await getAgentForMember(supabase, id)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const body = await req.json()
  const payload = agentChatRequestSchema.parse(body)
  const normalizedMessages = payload.messages.map(message => ({
    ...message,
    id: message.id ?? nanoid()
  })) as Message[]

  const conversation = await ensureConversation({
    supabase,
    agentId: agent.id,
    conversationId: payload.conversationId,
    userId: session.user.id,
    initialMessages: normalizedMessages
  })

  // Count user messages for max messages check
  const userMessageCount = normalizedMessages.filter(m => m.role === 'user').length

  const context = await fetchAgentFileContext({
    supabase,
    fileKeys: agent.fileKeys
  })

  const stream = await runAgentStream({
    agent,
    messages: normalizedMessages,
    context,
    toolContext: {
      fileContext: context
    },
    onCompletion: async completion => {
      const cleanedCompletion = stripCompletionMarkers(completion)
      const nextMessages = [
        ...normalizedMessages,
        {
          id: nanoid(),
          role: 'assistant' as const,
          content: cleanedCompletion
        }
      ]
      await updateConversationMessages({
        supabase,
        conversationId: conversation.id,
        messages: nextMessages,
        summary: null
      })
    }
  })

  const transformedStream = wrapStreamWithCompletionDetection(
    stream,
    agent.maxMessages,
    userMessageCount
  )

  return new StreamingTextResponse(transformedStream, {
    headers: {
      'x-conversation-id': conversation.id,
      'x-agent-mode': agent.mode,
      'x-max-messages': String(agent.maxMessages ?? '')
    }
  })
}
