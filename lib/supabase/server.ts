import { getServiceSupabaseClient } from './service-client'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db_types'

// Server-side Supabase client using the service role key.
// Used by backend utilities (permissions, features, tenant context).
export function createServerClient(): SupabaseClient<Database> {
  return getServiceSupabaseClient()
}

