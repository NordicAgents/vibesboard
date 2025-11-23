import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { getAgentForUser } from '@/lib/agents/server'
import { listAgentConversations } from '@/lib/agents/conversations'

export const runtime = 'nodejs'

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const cookieStore = cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore
  })

  const agent = await getAgentForUser(supabase, params.id, session.user.id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const conversations = await listAgentConversations(supabase, agent.id)
  return NextResponse.json({ conversations })
}
