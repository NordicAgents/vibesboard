'use client'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/db_types'

let browserClient: SupabaseClient<Database> | null = null

export function getBrowserSupabaseClient() {
  if (browserClient) {
    return browserClient
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anonKey) {
    throw new Error('Missing Supabase browser configuration')
  }

  browserClient = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true
    }
  })

  return browserClient
}
