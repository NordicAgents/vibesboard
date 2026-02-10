import { createServerClient } from '@/lib/supabase/server'
import type {
  WhatsAppAgentConnection,
  WhatsAppConnectionWithAgent,
  CreateConnectionParams,
  UpdateConnectionParams
} from './types'

/**
 * Normalize phone number to digits only for searching
 */
export function normalizePhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Validate phone number format (E.164)
 */
export function validatePhoneNumber(phone: string): boolean {
  // E.164 format: +[country code][number]
  // Length: 8-15 digits after +
  const e164Regex = /^\+[1-9]\d{7,14}$/
  return e164Regex.test(phone)
}

/**
 * Find active connection by phone number
 */
export async function findActiveConnection(
  phoneNumber: string
): Promise<WhatsAppConnectionWithAgent | null> {
  const supabase = await createServerClient()
  const normalized = normalizePhoneNumber(phoneNumber)

  const { data, error } = await supabase
    .from('whatsapp_agent_connections')
    .select(
      `
      *,
      agent:vibe_agents (
        id,
        user_id,
        name,
        mode,
        greeting_text,
        instructions,
        file_keys,
        agent_url,
        allow_anonymous,
        quick_suggestions_mode,
        quick_suggestions_count,
        max_messages,
        last_embeddings_sync_at,
        created_at,
        updated_at
      )
    `
    )
    .eq('phone_number_normalized', normalized)
    .eq('status', 'active')
    .maybeSingle()

  if (error) {
    console.error('Error finding connection:', error)
    return null
  }

  return data as WhatsAppConnectionWithAgent | null
}

/**
 * Find connection by ID
 */
export async function findConnectionById(
  connectionId: string
): Promise<WhatsAppAgentConnection | null> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('whatsapp_agent_connections')
    .select('*')
    .eq('id', connectionId)
    .maybeSingle()

  if (error) {
    console.error('Error finding connection by ID:', error)
    return null
  }

  return data as WhatsAppAgentConnection | null
}

/**
 * Create new phone number connection
 */
export async function createConnection(
  params: CreateConnectionParams,
  userId: string
): Promise<WhatsAppAgentConnection | null> {
  const supabase = await createServerClient()

  // Validate phone number
  if (!validatePhoneNumber(params.phone_number)) {
    throw new Error(
      'Invalid phone number format. Use E.164 format (e.g., +919400293288)'
    )
  }

  const normalized = normalizePhoneNumber(params.phone_number)

  // Check if phone already connected to this agent
  const { data: existing } = await supabase
    .from('whatsapp_agent_connections')
    .select('id, status')
    .eq('agent_id', params.agent_id)
    .eq('phone_number_normalized', normalized)
    .maybeSingle()

  if (
    existing &&
    (existing.status === 'active' || existing.status === 'pending')
  ) {
    throw new Error('This phone number is already connected to this agent')
  }

  // Create connection
  const { data, error } = await supabase
    .from('whatsapp_agent_connections')
    .insert({
      agent_id: params.agent_id,
      user_id: userId,
      phone_number: params.phone_number,
      phone_number_normalized: normalized,
      custom_intro_message: params.custom_intro_message || null,
      status: 'pending',
      expires_at: params.expires_at || null
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating connection:', error)
    throw new Error(`Failed to create connection: ${error.message}`)
  }

  return data as unknown as WhatsAppAgentConnection
}

/**
 * Update connection
 */
export async function updateConnection(
  connectionId: string,
  params: UpdateConnectionParams
): Promise<WhatsAppAgentConnection | null> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('whatsapp_agent_connections')
    .update({
      ...params,
      updated_at: new Date().toISOString()
    })
    .eq('id', connectionId)
    .select()
    .single()

  if (error) {
    console.error('Error updating connection:', error)
    return null
  }

  return data as unknown as WhatsAppAgentConnection
}

/**
 * Mark connection as active after intro sent
 */
export async function activateConnection(
  connectionId: string,
  introMessageId: string
): Promise<WhatsAppAgentConnection | null> {
  return updateConnection(connectionId, {
    status: 'active',
    intro_message_sent_at: new Date(),
    intro_message_id: introMessageId,
    connected_at: new Date()
  })
}

/**
 * Disconnect phone number from agent
 */
export async function disconnectConnection(
  connectionId: string,
  reason?: string
): Promise<WhatsAppAgentConnection | null> {
  return updateConnection(connectionId, {
    status: 'disconnected',
    disconnected_at: new Date(),
    disconnection_reason: reason || 'Manual disconnect'
  })
}

/**
 * Increment conversation counter
 */
export async function incrementConversationCount(
  connectionId: string
): Promise<void> {
  const supabase = await createServerClient()

  await supabase.rpc('increment_connection_conversations', {
    connection_id: connectionId
  })
}

/**
 * List connections for an agent
 */
export async function listAgentConnections(
  agentId: string,
  status?: string
): Promise<WhatsAppAgentConnection[]> {
  const supabase = await createServerClient()

  let query = supabase
    .from('whatsapp_agent_connections')
    .select('*')
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })

  if (status) {
    query = query.eq('status', status)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error listing connections:', error)
    return []
  }

  return (data || []) as unknown as WhatsAppAgentConnection[]
}

/**
 * Reset connection (close all conversations, reset stats)
 */
export async function resetConnection(connectionId: string): Promise<void> {
  const supabase = await createServerClient()

  // Close all active conversations for this connection
  await supabase
    .from('vibe_agent_conversations')
    .update({ closed_at: new Date().toISOString() })
    .eq('whatsapp_connection_id', connectionId)
    .is('closed_at', null)

  // Reset connection stats (set last_message_received_at to null explicitly)
  await supabase
    .from('whatsapp_agent_connections')
    .update({
      total_conversations: 0,
      last_message_received_at: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', connectionId)
}

/**
 * Expire old connections (run via cron)
 */
export async function expireOldConnections(): Promise<number> {
  const supabase = await createServerClient()

  const { data, error } = await supabase
    .from('whatsapp_agent_connections')
    .update({ status: 'expired' })
    .eq('status', 'active')
    .lt('expires_at', new Date().toISOString())
    .select()

  if (error) {
    console.error('Error expiring connections:', error)
    return 0
  }

  return data?.length || 0
}
