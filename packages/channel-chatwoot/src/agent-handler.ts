import 'server-only'

import { nanoid } from 'nanoid'
import type { Message } from '@vibesboard/contracts'
import type { VibeAgent } from '@vibesboard/contracts'
import type { ChatwootConnectionDocument } from '@vibesboard/contracts'
import { runAgentStream } from '@vibesboard/ai/runtime'
import {
  detectCompletionMarker,
  stripCompletionMarkers
} from '@vibesboard/ai/completion'
import {
  ensureConversation,
  markConversationHandedOff,
  updateConversationMessages
} from '@vibesboard/agents/conversations'
import { maybeAutoSummarize } from '@vibesboard/agents/auto-summarize'
import {
  sendChatwootMessage,
  handoffChatwootConversation
} from './api-client.ts'
import { decryptToken, updateConnectionStats } from './connections.ts'
import {
  dispatchAgentNotification,
  mapCompletionToEvent
} from '@vibesboard/agents/notifications'

export interface ChatwootMessagePayload {
  conversationId: number
  content: string
  senderName: string
  senderId: number
  inboxId: number
  accountId: number
}

/** Best-effort connection stats update; errors are logged, not thrown. */
async function recordConnectionStats(
  tenantId: string,
  agentId: string,
  connectionId: string
): Promise<void> {
  try {
    await updateConnectionStats(tenantId, agentId, connectionId)
  } catch (err) {
    console.error('[chatwoot] Failed to update connection stats', {
      error: err instanceof Error ? err.name : 'UnknownError'
    })
  }
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

  console.log('[chatwoot] Processing authenticated message')

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

    // 2. Run agent (inject handoff instructions for agent bot connections)
    const agentForStream = connection.useAgentBot
      ? {
          ...agent,
          instructions:
            (agent.instructions || '') +
            '\n\nIMPORTANT: If the customer asks to speak to a human agent, requests escalation, or you cannot resolve their issue, let them know you are connecting them with a human agent and end your response with [HANDOFF_TO_HUMAN].'
        }
      : agent

    let reply = ''
    let handoffRequested = false

    const stream = await runAgentStream({
      agent: agentForStream,
      messages: allMessages,
      onCompletion: async (completion: string) => {
        const reason = detectCompletionMarker(completion)
        handoffRequested = reason === 'handoff_to_human'
        reply = stripCompletionMarkers(completion)

        const nextMessages = [
          ...allMessages,
          { id: nanoid(), role: 'assistant' as const, content: reply }
        ]

        await updateConversationMessages({
          tenantId: agent.tenantId!,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages
        })

        await maybeAutoSummarize({
          tenantId: agent.tenantId!,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages,
          currentSummary: conversation.summary,
          summaryResponseCount: conversation.summaryResponseCount,
          responseCounts: conversation.responseCounts
        }).catch(err =>
          console.error('[chatwoot] Auto-summarize failed', {
            error: err instanceof Error ? err.name : 'UnknownError'
          })
        )

        const event = mapCompletionToEvent(reason)
        if (event) {
          dispatchAgentNotification({
            agent,
            conversationId: conversation.id,
            event,
            messageCount: allMessages.filter(m => m.role === 'user').length
          })
        }
      }
    })

    // Drain the stream to trigger onCompletion
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // 3. Send reply back to Chatwoot (use bot token if available)
    if (reply) {
      const replyToken =
        connection.useAgentBot && connection.encryptedBotToken
          ? decryptToken(connection.encryptedBotToken)
          : decryptToken(connection.encryptedApiToken)
      await sendChatwootMessage(
        connection.chatwootUrl,
        replyToken,
        connection.chatwootAccountId,
        conversationId,
        reply
      )
    }

    // 4. Hand off to human agents if requested
    if (handoffRequested && connection.useAgentBot) {
      try {
        const userToken = decryptToken(connection.encryptedApiToken)
        await handoffChatwootConversation(
          connection.chatwootUrl,
          userToken,
          connection.chatwootAccountId,
          conversationId
        )
        // Persist handoff state so the webhook handler skips future messages
        await markConversationHandedOff(
          agent.tenantId!,
          agent.id,
          conversation.id
        )
        console.log('[chatwoot] Conversation handed off to human agents')
      } catch (handoffErr) {
        console.error('[chatwoot] Failed to hand off conversation', {
          error: handoffErr instanceof Error ? handoffErr.name : 'UnknownError'
        })
      }
    }

    // 5. Update stats before the serverless request can be frozen.
    await recordConnectionStats(
      connection.tenantId,
      connection.agentId,
      connection.id
    )

    console.log(`[chatwoot] Reply sent (${reply.length} chars)`)
  } catch (error) {
    console.error('[chatwoot] Error processing message', {
      error: error instanceof Error ? error.name : 'UnknownError'
    })

    // Attempt to send error reply to Chatwoot
    try {
      const errorToken =
        connection.useAgentBot && connection.encryptedBotToken
          ? decryptToken(connection.encryptedBotToken)
          : decryptToken(connection.encryptedApiToken)
      await sendChatwootMessage(
        connection.chatwootUrl,
        errorToken,
        connection.chatwootAccountId,
        conversationId,
        'Sorry, I encountered an error processing your message. Please try again later.'
      )
    } catch (sendError) {
      console.error('[chatwoot] Failed to send error message', {
        error: sendError instanceof Error ? sendError.name : 'UnknownError'
      })
    }
  }
}
