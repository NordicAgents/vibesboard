import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { canEditAgent } from '@/lib/agents/permissions'
import { processFile } from '@/lib/agent/file-processor'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'

export const runtime = 'nodejs'

/**
 * GET /api/agents/[id]/files
 * List all files for an agent with processing status
 */
export async function GET(
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

  // Check permissions
  const { data: agent } = await supabase
    .from('vibe_agents')
    .select('id, user_id, tenant_id')
    .eq('id', id)
    .maybeSingle()

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.user_id,
    tenantId: agent.tenant_id
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Get query params
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')
  const from = (page - 1) * limit
  const to = from + limit - 1

  // Query files
  let query = supabase
    .from('agent_files')
    .select('*', { count: 'exact' })
    .eq('agent_id', id)
    .order('created_at', { ascending: false })

  if (status && ['pending', 'processing', 'indexed', 'failed'].includes(status)) {
    query = query.eq('status', status)
  }

  query = query.range(from, to)

  const { data: files, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    files: files ?? [],
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit)
    }
  })
}

/**
 * POST /api/agents/[id]/files
 * Upload new files to an existing agent
 */
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

  // Check permissions
  const { data: agent } = await supabase
    .from('vibe_agents')
    .select('id, user_id, tenant_id, file_keys')
    .eq('id', id)
    .maybeSingle()

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.user_id,
    tenantId: agent.tenant_id
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Parse request body
  const body = await req.json()
  const files: Array<{
    fileKey: string
    fileName: string
    fileSize: number
    mimeType: string
  }> = body.files || []

  if (!files.length) {
    return NextResponse.json(
      { error: 'No files provided' },
      { status: 400 }
    )
  }

  const serviceSupabase = getServiceSupabaseClient()

  // Create agent_files entries
  const fileEntries = files.map(file => ({
    agent_id: id,
    tenant_id: agent.tenant_id,
    user_id: session.user.id,
    file_key: file.fileKey,
    file_name: file.fileName,
    file_size: file.fileSize,
    mime_type: file.mimeType,
    status: 'pending' as const
  }))

  const { data: createdFiles, error: insertError } = await serviceSupabase
    .from('agent_files')
    .insert(fileEntries)
    .select('id, file_key, file_name, mime_type, status, created_at')

  if (insertError) {
    return NextResponse.json(
      { error: insertError.message },
      { status: 500 }
    )
  }

  // Update agent file_keys array
  const currentFileKeys = Array.isArray(agent.file_keys) ? agent.file_keys : []
  const newFileKeys = files.map(f => f.fileKey)
  const updatedFileKeys = Array.from(new Set([...currentFileKeys, ...newFileKeys]))

  await supabase
    .from('vibe_agents')
    .update({ file_keys: updatedFileKeys })
    .eq('id', id)

  // Trigger background processing (non-blocking)
  if (createdFiles && createdFiles.length > 0) {
    Promise.all(
      createdFiles.map(file =>
        processFile({
          fileId: file.id,
          agentId: id,
          fileKey: file.file_key,
          fileName: file.file_name,
          mimeType: file.mime_type || 'application/octet-stream'
        })
      )
    ).catch(error => {
      console.error('[File Upload] Background processing error:', error)
    })

    console.log(`[File Upload] Triggered processing for ${createdFiles.length} files`)
  }

  return NextResponse.json({ files: createdFiles })
}
