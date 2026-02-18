import { type SupabaseClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/db_types'
import { mapAgentRow } from './db'
import { type VibeAgent } from '@/lib/types'

type Client = SupabaseClient<Database>

export async function getAgentForUser(
  supabase: Client,
  id: string,
  userId: string
): Promise<VibeAgent | null> {
  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  return data ? mapAgentRow(data) : null
}

export async function getAgentBySlug(
  supabase: Client,
  slug: string
): Promise<VibeAgent | null> {
  const { data } = await supabase
    .from('vibe_agents')
    .select('*')
    .eq('agent_url', slug)
    .maybeSingle()

  return data ? mapAgentRow(data) : null
}
