import { StreamingTextResponse, type Message } from 'ai'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { getAgentForUser } from '@/lib/agents/server'
import { agentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { fetchAgentFileContext } from '@/lib/agent/rag'
import { runAgentStream } from '@/lib/agent/runtime'
import { nanoid } from '@/lib/utils'

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

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const agent = await getAgentForUser(supabase, params.id, session.user.id)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const body = await req.json()
  const payload = agentChatRequestSchema.parse(body)
  const normalizedMessages = payload.messages as Message[]
  const conversation = await ensureConversation({
    supabase,
    agentId: agent.id,
    conversationId: payload.conversationId,
    userId: session.user.id,
    initialMessages: normalizedMessages
  })

  const context = await fetchAgentFileContext({
    supabase,
    fileKeys: agent.fileKeys
  })

  const stream = await runAgentStream({
    agent,
    messages: normalizedMessages,
    context,
    onCompletion: async completion => {
      const newMessages = [
        ...normalizedMessages,
        {
          id: nanoid(),
          role: 'assistant' as const,
          content: completion
        }
      ]
      await updateConversationMessages({
        supabase,
        conversationId: conversation.id,
        messages: newMessages
      })
    }
  })

  return new StreamingTextResponse(stream, {
    headers: {
      'x-conversation-id': conversation.id
    }
  })
}
