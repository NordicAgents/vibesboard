import { type Message } from 'ai'
import { type SupabaseClient } from '@supabase/supabase-js'

import { type Database, type Json } from '@/lib/db_types'
import { mapConversationRow } from './db'
import { type VibeAgentConversation } from '@/lib/types'

type Client = SupabaseClient<Database, 'public', Database['public']>

interface ConversationIdentifier {
  conversationId?: string
  userId?: string | null
  externalId?: string | null
}

interface EnsureConversationArgs extends ConversationIdentifier {
  supabase: Client
  agentId: string
  initialMessages?: Message[]
}

export async function ensureConversation({
  supabase,
  agentId,
  conversationId,
  userId,
  externalId,
  initialMessages = []
}: EnsureConversationArgs): Promise<VibeAgentConversation> {
  if (conversationId) {
    const { data, error } = await supabase
      .from('vibe_agent_conversations')
      .select('*')
      .eq('id', conversationId)
      .maybeSingle()

    if (error) {
      throw error
    }

    if (data) {
      if (data.agent_id !== agentId) {
        throw new Error('Conversation does not belong to agent')
      }
      if (userId && data.user_id && data.user_id !== userId) {
        throw new Error('Unauthorized conversation access')
      }
      if (externalId && data.external_id && data.external_id !== externalId) {
        throw new Error('Unauthorized conversation access')
      }
      return mapConversationRow(data)
    }
  }

  const payload = {
    ...(conversationId ? { id: conversationId } : {}),
    agent_id: agentId,
    user_id: userId ?? null,
    external_id: externalId ?? null,
    messages: serializeMessages(initialMessages)
  }

  const { data, error } = await supabase
    .from('vibe_agent_conversations')
    .insert(payload)
    .select('*')
    .single()

  if (error) {
    throw error
  }

  return mapConversationRow(data)
}

interface UpdateConversationArgs extends ConversationIdentifier {
  supabase: Client
  conversationId: string
  messages: Message[]
  summary?: string | null
}

export async function updateConversationMessages({
  supabase,
  conversationId,
  messages,
  summary
}: UpdateConversationArgs) {
  const { error } = await supabase
    .from('vibe_agent_conversations')
    .update({
      messages: serializeMessages(messages),
      summary: summary ?? null,
      updated_at: new Date().toISOString()
    })
    .eq('id', conversationId)

  if (error) {
    throw error
  }
}

export async function listAgentConversations(
  supabase: Client,
  agentId: string,
  filter?: {
    userId?: string
    externalId?: string
  }
) {
  let query = supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('agent_id', agentId)

  if (filter?.userId) {
    query = query.eq('user_id', filter.userId)
  }
  if (filter?.externalId) {
    query = query.eq('external_id', filter.externalId)
  }

  const { data } = await query.order('updated_at', { ascending: false })

  return (data ?? []).map(mapConversationRow)
}

export async function getConversation(
  supabase: Client,
  id: string
): Promise<VibeAgentConversation | null> {
  const { data } = await supabase
    .from('vibe_agent_conversations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  return data ? mapConversationRow(data) : null
}

const serializeMessages = (messages: Message[]): Json =>
  messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content
  }))
