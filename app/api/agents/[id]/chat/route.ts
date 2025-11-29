import { StreamingTextResponse, type Message } from 'ai'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { getAgentForUser } from '@/lib/agents/server'
import { agentChatRequestSchema } from '@/lib/agents/schema'
import { fetchAgentFileContext } from '@/lib/agent/rag'
import { runAgentStream } from '@/lib/agent/runtime'
import { nanoid } from '@/lib/utils'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const agent = await getAgentForUser(supabase, id, session.user.id)

  if (!agent) {
    return new NextResponse('Agent not found', { status: 404 })
  }

  const body = await req.json()
  const payload = agentChatRequestSchema.parse(body)
  const normalizedMessages = payload.messages.map(message => ({
    ...message,
    id: message.id ?? nanoid()
  })) as Message[]

  const context = await fetchAgentFileContext({
    supabase,
    fileKeys: agent.fileKeys
  })

  const stream = await runAgentStream({
    agent,
    messages: normalizedMessages,
    context,
    toolContext: {
      fileContext: context
    }
  })

  return new StreamingTextResponse(stream)
}
