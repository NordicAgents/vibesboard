import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { mapAgentDoc, createAgentSlug, ensureUniqueSlug } from '@/lib/agents/db'
import { isMemberOfTenant, isSuperAdmin } from '@/lib/permissions'
import { getActiveTenant, getTenantById } from '@/lib/tenant-context'
import { upsertAgentSchema } from '@/lib/agents/schema'
import { processFile } from '@/lib/agent/file-processor'
import { nanoid } from '@/lib/utils'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenant_id')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '9')
  const from = (page - 1) * limit

  const isSuperAdminUser = tenantId
    ? await isSuperAdmin(user.id)
    : false

  if (tenantId && !isSuperAdminUser) {
    const isMember = await isMemberOfTenant(user.id, tenantId)
    if (!isMember) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Build the Firestore query
  let baseQuery: FirebaseFirestore.Query = adminDb
    .collection(Collections.agents(tenantId!))
    .orderBy('createdAt', 'desc')

  if (!tenantId) {
    // Fallback: show agents created by the user across all tenants
    baseQuery = adminDb
      .collectionGroup('agents')
      .where('userId', '==', user.id)
      .orderBy('createdAt', 'desc')
  }

  // Get total count
  const countSnapshot = await baseQuery.count().get()
  const total = countSnapshot.data().count

  // Apply pagination
  const snapshot = await baseQuery.offset(from).limit(limit).get()

  const agents = snapshot.docs.map(doc => mapAgentDoc(doc.data()))

  return NextResponse.json({
    agents,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  })
}

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  const body = await req.json()
  const payload = upsertAgentSchema.parse(body)

  // Resolve the tenant the new agent should belong to.
  const tenantId = await getActiveTenant(user.id)

  if (!tenantId) {
    return NextResponse.json(
      {
        error:
          'No tenant available for this user; ensure tenant membership exists.'
      },
      { status: 400 }
    )
  }

  // Look up the tenant slug for URL construction
  const tenant = await getTenantById(tenantId)
  const tenantSlug = tenant?.slug ?? 'unknown'

  const slug = await ensureUniqueSlug(createAgentSlug(payload.name), tenantId)

  const now = new Date().toISOString()
  const newId = nanoid()
  const docRef = adminDb.collection(Collections.agents(tenantId)).doc(newId)

  const agentData = {
    id: newId,
    userId: user.id,
    tenantId,
    tenantSlug,
    name: payload.name,
    instructions: payload.instructions,
    fileKeys: payload.fileKeys ?? [],
    tools: payload.tools ?? [],
    allowAnonymous: payload.allowAnonymous ?? false,
    agentUrl: slug,
    ...(payload.greetingText !== undefined && {
      greetingText: payload.greetingText
    }),
    mode: payload.mode ?? 'provider',
    ...(payload.maxMessages !== undefined && {
      maxMessages: payload.maxMessages
    }),
    quickSuggestionsMode: payload.quickSuggestionsMode ?? 'off',
    quickSuggestionsCount: payload.quickSuggestionsCount ?? 4,
    createdAt: now,
    updatedAt: now
  }

  try {
    await docRef.set(agentData)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to create agent' },
      { status: 500 }
    )
  }

  const agent = mapAgentDoc(agentData)

  // Auto-create agent_files entries for uploaded files (RAG Phase 1)
  if (payload.fileKeys && payload.fileKeys.length > 0) {
    await createAgentFilesAndTriggerProcessing({
      agentId: agent.id,
      tenantId,
      userId: user.id,
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

  try {
    const batch = adminDb.batch()
    const collPath = Collections.agentFiles(tenantId, agentId)
    const createdFiles: Array<{
      id: string
      agentId: string
      fileKey: string
      fileName: string
      mimeType: string
    }> = []

    for (const fileKey of fileKeys) {
      try {
        const fileName = fileKey.split('/').pop() || fileKey
        const mimeType = guessMimeType(fileName)

        const ref = adminDb.collection(collPath).doc()
        const now = new Date().toISOString()

        batch.set(ref, {
          id: ref.id,
          agentId,
          tenantId,
          userId,
          fileKey,
          fileName,
          fileSize: 0,
          mimeType,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        })

        createdFiles.push({
          id: ref.id,
          agentId,
          fileKey,
          fileName,
          mimeType
        })
      } catch (error) {
        console.error(`Failed to prepare file entry for ${fileKey}:`, error)
      }
    }

    if (createdFiles.length === 0) {
      return
    }

    await batch.commit()

    // Trigger background processing for each file (non-blocking)
    Promise.all(
      createdFiles.map(file =>
        processFile({
          fileId: file.id,
          agentId: file.agentId,
          tenantId,
          fileKey: file.fileKey,
          fileName: file.fileName,
          mimeType: file.mimeType || 'application/octet-stream'
        })
      )
    ).catch(error => {
      console.error('[Agent Creation] Background file processing error:', error)
    })

    console.log(`[Agent Creation] Triggered processing for ${createdFiles.length} files`)
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
