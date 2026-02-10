import { type Message } from 'ai'
import { nanoid } from 'nanoid'
import type { VibeAgent } from '@/lib/types'
import type { WhatsAppConnectionWithAgent } from './types'
import { runAgentStream } from '@/lib/agent/runtime'
import {
  stripCompletionMarkers,
  detectCompletionMarker
} from '@/lib/agent/completion'
import {
  ensureWhatsAppConversation,
  addMessageToConversation,
  closeWhatsAppConversation,
  getConversationMessages
} from './conversation-manager'
import {
  formatResponseForWhatsApp,
  hasCompletionMarker,
  stripMarkers
} from './response-formatter'
import { sendWhatsAppMessage } from './sender'
import { incrementConversationCount } from './connections'

/**
 * Handle incoming WhatsApp message and generate agent response
 */
export async function handleWhatsAppMessage(
  connection: WhatsAppConnectionWithAgent,
  messageText: string,
  whatsappMessageId: string,
  phoneNumberId: string,
  accessToken: string
): Promise<void> {
  const dbAgent = connection.agent
  const phoneNumber = connection.phone_number

  console.log(
    `📨 Processing message from ${phoneNumber} for agent ${dbAgent.name}`
  )

  // Convert database agent format to VibeAgent type
  const agent: VibeAgent = {
    id: dbAgent.id,
    userId: dbAgent.user_id,
    name: dbAgent.name,
    instructions: dbAgent.instructions,
    fileKeys: dbAgent.file_keys || [],
    agentUrl: dbAgent.agent_url,
    tools: [], // WhatsApp agents don't use tools
    allowAnonymous: dbAgent.allow_anonymous,
    greetingText: dbAgent.greeting_text,
    mode: dbAgent.mode,
    maxMessages: dbAgent.max_messages,
    quickSuggestionsMode: dbAgent.quick_suggestions_mode,
    quickSuggestionsCount: dbAgent.quick_suggestions_count,
    lastEmbeddingsSyncAt: dbAgent.last_embeddings_sync_at,
    createdAt: dbAgent.created_at,
    updatedAt: dbAgent.updated_at
  }

  try {
    // 1. Ensure conversation exists
    const conversation = await ensureWhatsAppConversation(
      connection.id,
      agent.id,
      phoneNumber
    )

    console.log(`💬 Conversation ID: ${conversation.id}`)

    // 2. Add user message to conversation
    const userMessage: Message = {
      id: nanoid(),
      role: 'user',
      content: messageText
    }

    await addMessageToConversation(
      conversation.id,
      userMessage,
      whatsappMessageId
    )

    // 3. Get conversation history
    const messages = await getConversationMessages(conversation.id)

    console.log(`📜 Conversation has ${messages.length} messages`)

    // 4. Run agent to get response
    console.log(`🤖 Running agent...`)
    const stream = await runAgentStream({
      agent,
      messages,
      temperature: 0.1
    })

    // 5. Consume stream to get full response
    const response = await streamToString(stream)

    console.log(`✅ Agent response received (${response.length} chars)`)

    // 6. Detect completion
    const isComplete = hasCompletionMarker(response)
    const completionReason = detectCompletionMarker(response)

    // Check max messages
    const userMessageCount = messages.filter(m => m.role === 'user').length
    const maxMessagesReached = Boolean(
      agent.maxMessages && userMessageCount >= agent.maxMessages
    )

    const shouldComplete = isComplete || maxMessagesReached

    console.log(
      `🎯 Completion status: ${shouldComplete ? 'COMPLETE' : 'ongoing'}`
    )
    if (completionReason) {
      console.log(`   Reason: ${completionReason}`)
    }
    if (maxMessagesReached) {
      console.log(
        `   Max messages reached: ${userMessageCount}/${agent.maxMessages}`
      )
    }

    // 7. Strip markers from response
    const cleanResponse = stripMarkers(response)

    // 8. Save assistant message to conversation
    const assistantMessage: Message = {
      id: nanoid(),
      role: 'assistant',
      content: cleanResponse
    }

    await addMessageToConversation(conversation.id, assistantMessage)

    // 9. Format response for WhatsApp
    const whatsappResponse = formatResponseForWhatsApp(
      agent,
      response,
      shouldComplete
    )

    console.log(`📤 Sending WhatsApp response (type: ${whatsappResponse.type})`)

    // 10. Send response via WhatsApp
    await sendWhatsAppMessage({
      to: phoneNumber,
      response: whatsappResponse,
      phoneNumberId,
      accessToken
    })

    // 11. If complete, close conversation
    if (shouldComplete) {
      console.log(`🏁 Closing conversation`)
      await closeWhatsAppConversation(conversation.id)
    }

    // 12. Update connection stats
    if (messages.length === 1) {
      // This was the first user message, increment conversation count
      await incrementConversationCount(connection.id)
    }

    console.log(`✅ Message processing complete`)
  } catch (error) {
    console.error(`❌ Error processing WhatsApp message:`, error)

    // Send error message to user
    try {
      await sendWhatsAppMessage({
        to: phoneNumber,
        response: {
          type: 'text',
          text: 'Sorry, I encountered an error processing your message. Please try again later.'
        },
        phoneNumberId,
        accessToken
      })
    } catch (sendError) {
      console.error(`❌ Failed to send error message:`, sendError)
    }

    throw error
  }
}

/**
 * Helper to consume a ReadableStream and return the full text
 */
async function streamToString(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let result = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      result += decoder.decode(value, { stream: true })
    }
    // Final decode with stream: false
    result += decoder.decode()
    return result
  } finally {
    reader.releaseLock()
  }
}
