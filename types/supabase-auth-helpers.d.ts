import { type SupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

declare module '@supabase/auth-helpers-nextjs' {
  export function createRouteHandlerClient<
    Database = any,
    SchemaName extends string & keyof Database = 'public' extends keyof Database
      ? 'public'
      : string & keyof Database
  >(
    context: { cookies: () => ReturnType<typeof cookies> },
    options?: any
  ): SupabaseClient<Database, SchemaName>

  export const createServerActionClient: typeof createRouteHandlerClient

  export function createServerComponentClient<
    Database = any,
    SchemaName extends string & keyof Database = 'public' extends keyof Database
      ? 'public'
      : string & keyof Database
  >(
    context: { cookies: () => ReturnType<typeof cookies> },
    options?: any
  ): SupabaseClient<Database, SchemaName>

  export function createClientComponentClient<
    Database = any,
    SchemaName extends string & keyof Database = 'public' extends keyof Database
      ? 'public'
      : string & keyof Database
  >(options?: any): SupabaseClient<Database, SchemaName>
}
