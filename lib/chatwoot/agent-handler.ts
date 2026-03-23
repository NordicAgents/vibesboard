import 'server-only'

import { nanoid } from 'nanoid'
import type { Message } from 'ai'
import type { VibeAgent } from '@/lib/types'
import type { ChatwootConnectionDocument } from '@/lib/firestore-types'
import { runAgentStream } from '@/lib/agent/runtime'
import { stripCompletionMarkers } from '@/lib/agent/completion'
import {
  ensureConversation,
  updateConversationMessages
} from '@/lib/agents/conversations'
import { sendChatwootMessage } from './api-client'
import { decryptToken, updateConnectionStats } from './connections'

export interface ChatwootMessagePayload {
  conversationId: number
  content: string
  senderName: string
  senderId: number
  inboxId: number
  accountId: number
}

/**
 * Handle an incoming Chatwoot message:
 * ensure conversation, run agent, send reply back to Chatwoot.
 */
export async function handleChatwootMessage(
  connection: ChatwootConnectionDocument,
  agent: VibeAgent,
  payload: ChatwootMessagePayload
): Promise<void> {
  const { conversationId, content, accountId } = payload
  const externalId = `chatwoot:${accountId}:${conversationId}`

  console.log(
    `[chatwoot] Processing message for agent ${agent.name} (conversation ${conversationId})`
  )

  try {
    // 1. Ensure conversation
    const userMessage: Message = {
      id: nanoid(),
      role: 'user',
      content
    }

    const conversation = await ensureConversation({
      tenantId: agent.tenantId!,
      agentId: agent.id,
      userId: null,
      externalId,
      initialMessages: [userMessage]
    })

    // Reconstruct full message history
    const priorMessages = conversation.messages ?? []
    const allMessages = priorMessages.some(
      (m: Message) => m.id === userMessage.id
    )
      ? priorMessages
      : [...priorMessages, userMessage]

    // 2. Run agent
    let reply = ''

    const stream = await runAgentStream({
      agent,
      messages: allMessages,
      onCompletion: async (completion: string) => {
        reply = stripCompletionMarkers(completion)

        const nextMessages = [
          ...allMessages,
          { id: nanoid(), role: 'assistant' as const, content: reply }
        ]

        await updateConversationMessages({
          tenantId: agent.tenantId!,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages,
          summary: null
        })
      }
    })

    // Drain the stream to trigger onCompletion
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // 3. Send reply back to Chatwoot
    if (reply) {
      const apiToken = decryptToken(connection.encryptedApiToken)
      await sendChatwootMessage(
        connection.chatwootUrl,
        apiToken,
        connection.chatwootAccountId,
        conversationId,
        reply
      )
    }

    // 4. Update stats (fire-and-forget)
    updateConnectionStats(
      connection.tenantId,
      connection.agentId,
      connection.id
    )

    console.log(
      `[chatwoot] Reply sent (${reply.length} chars) to conversation ${conversationId}`
    )
  } catch (error) {
    console.error('[chatwoot] Error processing message:', error)

    // Attempt to send error reply to Chatwoot
    try {
      const apiToken = decryptToken(connection.encryptedApiToken)
      await sendChatwootMessage(
        connection.chatwootUrl,
        apiToken,
        connection.chatwootAccountId,
        conversationId,
        'Sorry, I encountered an error processing your message. Please try again later.'
      )
    } catch (sendError) {
      console.error('[chatwoot] Failed to send error message:', sendError)
    }
  }
}
