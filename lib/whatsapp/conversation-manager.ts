import { type Message } from 'ai'
import { createServerClient } from '@/lib/supabase/server'
import { nanoid } from 'nanoid'
import type { VibeAgentConversation } from '@/lib/types'
import { mapConversationRow } from '@/lib/agents/db'

/**
 * Find or create active WhatsApp conversation for connection
 */
export async function ensureWhatsAppConversation(
  connectionId: string,
  agentId: string,
  phoneNumber: string,
  initialMessages: Message[] = []
): Promise<VibeAgentConversation> {
  const supabase = await createServerClient()

  // Try to find existing open conversation
  const { data: existing } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('whatsapp_connection_id', connectionId)
    .eq('agent_id', agentId)
    .is('closed_at', null)
    .maybeSingle()

  if (existing) {
    return mapConversationRow(existing)
  }

  // Create new conversation
  const { data, error } = await supabase
    .from('vibe_agent_conversations')
    .insert({
      agent_id: agentId,
      channel: 'whatsapp',
      whatsapp_connection_id: connectionId,
      whatsapp_phone_number: phoneNumber,
      external_id: phoneNumber,
      messages: serializeMessages(initialMessages),
      whatsapp_message_ids: []
    })
    .select('*')
    .single()

  if (error) {
    throw new Error(`Failed to create WhatsApp conversation: ${error.message}`)
  }

  return mapConversationRow(data)
}

/**
 * Add message to WhatsApp conversation
 */
export async function addMessageToConversation(
  conversationId: string,
  message: Message,
  whatsappMessageId?: string
): Promise<void> {
  const supabase = await createServerClient()

  // Get current conversation
  const { data: conversation } = (await supabase
    .from('vibe_agent_conversations')
    .select('messages, whatsapp_message_ids')
    .eq('id', conversationId)
    .single()) as any

  if (!conversation) {
    throw new Error('Conversation not found')
  }

  const currentMessages = (conversation.messages as any[]) || []
  const currentMessageIds =
    (conversation.whatsapp_message_ids as string[]) || []

  // Add new message
  const updatedMessages = [
    ...currentMessages,
    {
      id: message.id,
      role: message.role,
      content: message.content
    }
  ]

  // Add WhatsApp message ID if provided
  const updatedMessageIds = whatsappMessageId
    ? [...currentMessageIds, whatsappMessageId]
    : currentMessageIds

  // Update conversation
  const { error } = await supabase
    .from('vibe_agent_conversations')
    .update({
      messages: updatedMessages,
      whatsapp_message_ids: updatedMessageIds,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)

  if (error) {
    throw new Error(`Failed to update conversation: ${error.message}`)
  }
}

/**
 * Close WhatsApp conversation
 */
export async function closeWhatsAppConversation(
  conversationId: string
): Promise<void> {
  const supabase = await createServerClient()

  const { error } = await supabase
    .from('vibe_agent_conversations')
    .update({
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)

  if (error) {
    throw new Error(`Failed to close conversation: ${error.message}`)
  }
}

/**
 * Get conversation messages
 */
export async function getConversationMessages(
  conversationId: string
): Promise<Message[]> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('vibe_agent_conversations')
    .select('messages')
    .eq('id', conversationId)
    .single()

  if (error || !data) {
    return []
  }

  const messages = (data.messages as any[]) || []
  return messages.map(msg => ({
    id: msg.id || nanoid(),
    role: msg.role as 'user' | 'assistant' | 'system',
    content: msg.content as string
  }))
}

/**
 * Helper to serialize messages for storage
 */
function serializeMessages(messages: Message[]): any[] {
  return messages.map(msg => ({
    id: msg.id,
    role: msg.role,
    content: msg.content
  }))
}
