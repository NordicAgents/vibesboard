import 'server-only'

import { nanoid } from 'nanoid'
import type { Message } from '@vibesboard/contracts'
import type { VibeAgent } from '@vibesboard/contracts'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { runAgentStream } from '@vibesboard/ai/runtime'
import {
  detectCompletionMarker,
  stripCompletionMarkers
} from '@vibesboard/ai/completion'
import { maybeAutoSummarize } from '@vibesboard/agents/auto-summarize'
import {
  ensureConversation,
  isConversationHandedOff,
  markConversationHandedOff,
  updateConversationMessages
} from '@vibesboard/agents/conversations'
import {
  dispatchAgentNotification,
  mapCompletionToEvent
} from '@vibesboard/agents/notifications'
import { resolveInboxAgent, type InboxChannel } from './resolve-agent.ts'
import {
  sendWhatsAppAgentReply,
  sendInstagramAgentReply,
  type InboxReplyParams
} from './reply-adapters.ts'

export interface InboxAgentContext {
  channel: InboxChannel
  tenantId: string
  accountId: string
  contactId: string
  contactName?: string
  messageText: string
  windowExpiresAt: string
}

type ReplyFunction = (params: InboxReplyParams) => Promise<any>

/**
 * Entry point called from webhook handlers.
 * Resolves the agent and dispatches message handling (fire-and-forget).
 */
export async function triggerInboxAgent(
  context: InboxAgentContext
): Promise<void> {
  const { channel, tenantId, accountId, contactId, messageText } = context

  if (!messageText) return

  const result = await resolveInboxAgent(
    tenantId,
    accountId,
    contactId,
    channel
  )
  if (!result) return

  const { agent } = result

  const replyFn: ReplyFunction =
    channel === 'whatsapp' ? sendWhatsAppAgentReply : sendInstagramAgentReply

  await handleInboxAgentMessage(context, agent, replyFn)
}

/**
 * Handle an incoming inbox message:
 * ensure agent conversation, run agent, send reply via channel API.
 *
 * Modeled on lib/chatwoot/agent-handler.ts handleChatwootMessage().
 */
async function handleInboxAgentMessage(
  context: InboxAgentContext,
  agent: VibeAgent,
  replyFn: ReplyFunction
): Promise<void> {
  const {
    channel,
    tenantId,
    accountId,
    contactId,
    messageText,
    windowExpiresAt
  } = context

  const externalId = `inbox:${channel}:${accountId}:${contactId}`

  console.log(
    `[inbox-agent] Processing ${channel} message for agent ${agent.name} (contact ${contactId})`
  )

  try {
    // 1. Check if already handed off
    const handedOff = await isConversationHandedOff(
      tenantId,
      agent.id,
      externalId
    )
    if (handedOff) {
      console.log(
        `[inbox-agent] Conversation ${externalId} is handed off, skipping`
      )
      return
    }

    // 2. Check 24h messaging window
    if (new Date(windowExpiresAt) <= new Date()) {
      console.log(
        `[inbox-agent] 24h window expired for ${externalId}, skipping`
      )
      return
    }

    // 3. Ensure agent conversation
    const userMessage: Message = {
      id: nanoid(),
      role: 'user',
      content: messageText
    }

    const conversation = await ensureConversation({
      tenantId,
      agentId: agent.id,
      userId: null,
      externalId,
      initialMessages: [userMessage]
    })

    // 4. Reconstruct message history
    const priorMessages = conversation.messages ?? []
    const allMessages = priorMessages.some(
      (m: Message) => m.id === userMessage.id
    )
      ? priorMessages
      : [...priorMessages, userMessage]

    // 5. Inject handoff instructions (always enabled for inbox agents)
    const agentForStream: VibeAgent = {
      ...agent,
      instructions:
        (agent.instructions || '') +
        '\n\nIMPORTANT: If the customer asks to speak to a human agent, requests escalation, or you cannot resolve their issue, let them know you are connecting them with a human agent and end your response with [HANDOFF_TO_HUMAN].'
    }

    // 6. Run agent stream
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
          tenantId,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages
        })

        maybeAutoSummarize({
          tenantId,
          agentId: agent.id,
          conversationId: conversation.id,
          messages: nextMessages,
          currentSummary: conversation.summary,
          summaryResponseCount: conversation.summaryResponseCount,
          responseCounts: conversation.responseCounts
        }).catch(err => console.error('[inbox] Auto-summarize failed:', err))

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

    // 7. Drain stream to trigger onCompletion
    const reader = stream.getReader()
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }

    // 8. Send reply via channel API
    if (reply) {
      await replyFn({
        tenantId,
        accountId,
        contactId,
        text: reply,
        agentId: agent.id,
        agentName: agent.name
      })
    }

    // 9. Handle handoff to human
    if (handoffRequested) {
      try {
        await markConversationHandedOff(tenantId, agent.id, conversation.id)

        // Update inbox conversation doc to reflect handoff
        const convoPath =
          channel === 'whatsapp'
            ? Collections.whatsappInboxConversations(tenantId, accountId)
            : Collections.instagramInboxConversations(tenantId, accountId)

        await adminDb.collection(convoPath).doc(contactId).update({
          agentHandedOff: true,
          updatedAt: new Date().toISOString()
        })

        console.log(
          `[inbox-agent] Handed off ${channel} conversation ${contactId} to human`
        )
      } catch (handoffErr) {
        console.error(
          '[inbox-agent] Failed to hand off conversation:',
          handoffErr
        )
      }
    }

    // 10. Link agent conversation to inbox conversation (first time only)
    if (conversation.messages.length <= 1) {
      try {
        const convoPath =
          channel === 'whatsapp'
            ? Collections.whatsappInboxConversations(tenantId, accountId)
            : Collections.instagramInboxConversations(tenantId, accountId)

        await adminDb.collection(convoPath).doc(contactId).update({
          agentConversationId: conversation.id,
          updatedAt: new Date().toISOString()
        })
      } catch {
        // Non-critical — don't fail the message handling
      }
    }

    console.log(
      `[inbox-agent] Reply sent (${reply.length} chars) via ${channel} to ${contactId}`
    )
  } catch (error) {
    console.error(`[inbox-agent] Error processing ${channel} message:`, error)
  }
}
