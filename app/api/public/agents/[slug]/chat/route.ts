import { NextRequest, NextResponse } from 'next/server'
import { StreamingTextResponse, type Message } from 'ai'

import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { getAgentBySlug } from '@/lib/agents/server'
import { publicAgentChatRequestSchema } from '@/lib/agents/schema'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { fetchAgentFileContext } from '@/lib/agent/rag'
import { runAgentStream } from '@/lib/agent/runtime'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import { nanoid } from '@/lib/utils'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const supabase = getServiceSupabaseClient()
  const agent = await getAgentBySlug(supabase, slug)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  if (!agent.allowAnonymous) {
    return new NextResponse('Agent does not allow anonymous chat', {
      status: 403
    })
  }

  const externalId = await ensureExternalSessionId()
  const body = await req.json()
  const payload = publicAgentChatRequestSchema.parse({
    ...body,
    externalId
  })
  const normalizedMessages = payload.messages.map(message => ({
    ...message,
    id: message.id ?? nanoid()
  })) as Message[]

  const conversation = await ensureConversation({
    supabase,
    agentId: agent.id,
    externalId,
    conversationId: payload.conversationId,
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
    toolContext: {
      fileContext: context
    },
    onCompletion: async completion => {
      const nextMessages = [
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
        messages: nextMessages,
        summary: null
      })
    }
  })

  return new StreamingTextResponse(stream, {
    headers: {
      'x-conversation-id': conversation.id
    }
  })
}
