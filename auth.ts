import 'server-only'
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export const auth = async ({
  cookieStore
}: {
  cookieStore: Awaited<ReturnType<typeof cookies>>
}) => {
  // Create a Supabase client configured to use cookies
  const supabase = createServerComponentClient({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}
