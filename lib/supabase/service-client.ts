import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/db_types'

let cachedClient: SupabaseClient<Database> | null = null

export function getServiceSupabaseClient() {
  if (cachedClient) {
    return cachedClient
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    throw new Error('Missing Supabase service role configuration')
  }

  cachedClient = createClient<Database>(url, serviceKey, {
    auth: {
      persistSession: false
    }
  })

  return cachedClient
}
