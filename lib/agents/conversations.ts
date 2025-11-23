import { type Message } from 'ai'
import { type SupabaseClient } from '@supabase/supabase-js'

import { type Database, type Json } from '@/lib/db_types'
import { mapConversationRow } from './db'
import { type VibeAgentConversation } from '@/lib/types'

type Client = SupabaseClient<any>
type ConversationRow = Database['public']['Tables']['vibe_agent_conversations']['Row']
type ConversationInsert = Database['public']['Tables']['vibe_agent_conversations']['Insert']
type ConversationUpdate = Database['public']['Tables']['vibe_agent_conversations']['Update']

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
      .maybeSingle<ConversationRow>()

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

  const payload: ConversationInsert = {
    ...(conversationId ? { id: conversationId } : {}),
    agent_id: agentId,
    user_id: userId ?? null,
    external_id: externalId ?? null,
    messages: serializeMessages(initialMessages)
  }

  const { data, error } = await supabase
    .from('vibe_agent_conversations')
    .insert(payload as ConversationInsert)
    .select('*')
    .single<ConversationRow>()

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
  const updatePayload: ConversationUpdate = {
    messages: serializeMessages(messages),
    summary: summary ?? null,
    updated_at: new Date().toISOString()
  }

  const { error } = await supabase
    .from('vibe_agent_conversations')
    .update(updatePayload as ConversationUpdate)
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
    .maybeSingle<ConversationRow>()

  return data ? mapConversationRow(data) : null
}

const serializeMessages = (messages: Message[]): ConversationInsert['messages'] =>
  messages.map(message => ({
    id: message.id,
    role: message.role,
    content: message.content
  }))
