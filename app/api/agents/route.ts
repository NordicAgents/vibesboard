import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'

import { auth } from '@/auth'
import { type Database } from '@/lib/db_types'
import { mapAgentRow, createAgentSlug, ensureUniqueSlug } from '@/lib/agents/db'
import { isMemberOfTenant, isSuperAdmin } from '@/lib/permissions'
import { getActiveTenant } from '@/lib/tenant-context'
import { upsertAgentSchema } from '@/lib/agents/schema'
import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { processFile } from '@/lib/agent/file-processor'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenant_id')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '9')
  const from = (page - 1) * limit
  const to = from + limit - 1

  const isSuperAdminUser = tenantId
    ? await isSuperAdmin(session.user.id)
    : false

  if (tenantId && !isSuperAdminUser) {
    const isMember = await isMemberOfTenant(session.user.id, tenantId)
    if (!isMember) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  const supabase = isSuperAdminUser
    ? getServiceSupabaseClient()
    : createRouteHandlerClient<Database>({
        cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
      })

  // Start building the query
  let query = supabase
    .from('vibe_agents')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })

  if (tenantId) {
    // If tenant_id is provided, filter by it
    query = query.eq('tenant_id', tenantId)
  } else {
    // Fallback: show agents created by the user (legacy behavior)
    query = query.eq('user_id', session.user.id)
  }

  // Apply pagination
  query = query.range(from, to)

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    agents: (data ?? []).map(mapAgentRow),
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit)
    }
  })
}

export async function POST(req: Request) {
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })

  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const body = await req.json()
  const payload = upsertAgentSchema.parse(body)

  const supabase = createRouteHandlerClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })

  // Resolve the tenant the new agent should belong to.
  // Use the active tenant cookie, falling back to a deterministic default.
  const tenantId = await getActiveTenant(session.user.id)

  if (!tenantId) {
    return NextResponse.json(
      {
        error:
          'No tenant available for this user; ensure tenant membership exists.'
      },
      { status: 400 }
    )
  }

  const slug = await ensureUniqueSlug(createAgentSlug(payload.name), supabase)

  // Build insert payload - mode/max_messages are optional until migration is applied
  const insertPayload = {
    user_id: session.user.id,
    tenant_id: tenantId,
    name: payload.name,
    instructions: payload.instructions,
    file_keys: payload.fileKeys,
    tools: payload.tools,
    allow_anonymous: payload.allowAnonymous,
    agent_url: slug,
    ...(payload.greetingText !== undefined && {
      greeting_text: payload.greetingText
    }),
    ...(payload.mode !== undefined && { mode: payload.mode }),
    ...(payload.maxMessages !== undefined && {
      max_messages: payload.maxMessages
    }),
    ...(payload.quickSuggestionsMode !== undefined && {
      quick_suggestions_mode: payload.quickSuggestionsMode
    }),
    ...(payload.quickSuggestionsCount !== undefined && {
      quick_suggestions_count: payload.quickSuggestionsCount
    })
  }

  const { data, error } = await supabase
    .from('vibe_agents')
    .insert(insertPayload)
    .select('*')
    .single()

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Unable to create agent' },
      { status: 500 }
    )
  }

  const agent = mapAgentRow(data)

  // Auto-create agent_files entries for uploaded files (RAG Phase 1)
  if (payload.fileKeys && payload.fileKeys.length > 0) {
    await createAgentFilesAndTriggerProcessing({
      agentId: agent.id,
      tenantId,
      userId: session.user.id,
      fileKeys: payload.fileKeys
    })
  }

  return NextResponse.json({ agent })
}

/**
 * Create agent_files entries and trigger background processing
 * This enables auto-processing of uploaded files for RAG
 */
async function createAgentFilesAndTriggerProcessing(params: {
  agentId: string
  tenantId: string
  userId: string
  fileKeys: string[]
}) {
  const { agentId, tenantId, userId, fileKeys } = params
  const serviceSupabase = getServiceSupabaseClient()

  try {
    // Get file metadata from storage
    const fileEntries = await Promise.all(
      fileKeys.map(async (fileKey) => {
        try {
          // Get file info from storage
          const { data: fileData } = await serviceSupabase.storage
            .from('agent-files')
            .download(fileKey)

          const fileName = fileKey.split('/').pop() || fileKey
          const fileSize = fileData?.size || 0
          const mimeType = fileData?.type || guessMimeType(fileName)

          return {
            agent_id: agentId,
            tenant_id: tenantId,
            user_id: userId,
            file_key: fileKey,
            file_name: fileName,
            file_size: fileSize,
            mime_type: mimeType,
            status: 'pending'
          }
        } catch (error) {
          console.error(`Failed to get metadata for ${fileKey}:`, error)
          return null
        }
      })
    )

    const validEntries = fileEntries.filter(Boolean)

    if (validEntries.length === 0) {
      return
    }

    // Insert into agent_files table
    const { data: createdFiles, error: insertError } = await serviceSupabase
      .from('agent_files')
      .insert(validEntries)
      .select('id, agent_id, file_key, file_name, mime_type')

    if (insertError) {
      console.error('[Agent Creation] Failed to create agent_files:', insertError)
      return
    }

    // Trigger background processing for each file (non-blocking)
    if (createdFiles && createdFiles.length > 0) {
      // Process files in background (don't await)
      Promise.all(
        createdFiles.map(file =>
          processFile({
            fileId: file.id,
            agentId: file.agent_id,
            fileKey: file.file_key,
            fileName: file.file_name,
            mimeType: file.mime_type || 'application/octet-stream'
          })
        )
      ).catch(error => {
        console.error('[Agent Creation] Background file processing error:', error)
      })

      console.log(`[Agent Creation] Triggered processing for ${createdFiles.length} files`)
    }
  } catch (error) {
    console.error('[Agent Creation] Error in file processing setup:', error)
  }
}

/**
 * Guess MIME type from file extension
 */
function guessMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop()
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    htm: 'text/html',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}
