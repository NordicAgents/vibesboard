import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { ingestFileForAgent } from '@/lib/agent/file-search'
import { type Database } from '@/lib/db_types'

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

  const body = await req.json().catch(() => ({}))
  const fileKey = String(body?.fileKey ?? '').trim()
  const fileName = typeof body?.fileName === 'string' ? body.fileName : undefined
  const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : undefined

  if (!fileKey) {
    return NextResponse.json(
      { error: 'fileKey is required for ingestion' },
      { status: 400 }
    )
  }

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  const { data: agent } = await supabase
    .from('vibe_agents')
    .select('id,user_id,file_keys')
    .eq('id', id)
    .eq('user_id', session.user.id)
    .maybeSingle()

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const fileKeys = Array.isArray(agent.file_keys) ? agent.file_keys : []
  if (!fileKeys.includes(fileKey)) {
    return NextResponse.json(
      { error: 'fileKey is not attached to this agent' },
      { status: 400 }
    )
  }

  try {
    const result = await ingestFileForAgent({
      agentId: id,
      fileKey,
      fileName,
      mimeType
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Ingestion failed'
      },
      { status: 500 }
    )
  }
}
