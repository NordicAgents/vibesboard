import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import { processFile } from '@/lib/agent/file-processor'

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
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  // Find agent via collectionGroup query
  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
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

  const collPath = Collections.agentFiles(agent.tenantId, id)

  // Build the query
  let baseQuery: FirebaseFirestore.Query = adminDb
    .collection(collPath)
    .orderBy('createdAt', 'desc')

  if (status && ['pending', 'processing', 'indexed', 'failed'].includes(status)) {
    baseQuery = baseQuery.where('status', '==', status)
  }

  // Get total count
  const countSnapshot = await baseQuery.count().get()
  const total = countSnapshot.data().count

  // Apply pagination
  const snapshot = await baseQuery.offset(from).limit(limit).get()

  const files = snapshot.docs.map(doc => doc.data())

  return NextResponse.json({
    files,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
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
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  // Find agent via collectionGroup query
  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
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

  const collPath = Collections.agentFiles(agent.tenantId, id)
  const batch = adminDb.batch()
  const now = new Date().toISOString()

  const createdFiles: Array<{
    id: string
    fileKey: string
    fileName: string
    mimeType: string
    status: string
    createdAt: string
  }> = []

  for (const file of files) {
    const ref = adminDb.collection(collPath).doc()
    const fileDoc = {
      id: ref.id,
      agentId: id,
      tenantId: agent.tenantId,
      userId: user.id,
      fileKey: file.fileKey,
      fileName: file.fileName,
      fileSize: file.fileSize,
      mimeType: file.mimeType,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    }
    batch.set(ref, fileDoc)
    createdFiles.push({
      id: ref.id,
      fileKey: file.fileKey,
      fileName: file.fileName,
      mimeType: file.mimeType,
      status: 'pending',
      createdAt: now
    })
  }

  try {
    await batch.commit()
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create file records' },
      { status: 500 }
    )
  }

  // Update agent fileKeys array
  const currentFileKeys = agent.fileKeys ?? []
  const newFileKeys = files.map(f => f.fileKey)
  const updatedFileKeys = Array.from(new Set([...currentFileKeys, ...newFileKeys]))

  const agentDocRef = adminDb
    .collection(Collections.agents(agent.tenantId))
    .doc(id)

  await agentDocRef.update({ fileKeys: updatedFileKeys, updatedAt: now })

  // Trigger background processing (non-blocking)
  if (createdFiles.length > 0) {
    Promise.all(
      createdFiles.map(file =>
        processFile({
          fileId: file.id,
          agentId: id,
          tenantId: agent.tenantId,
          fileKey: file.fileKey,
          fileName: file.fileName,
          mimeType: file.mimeType || 'application/octet-stream'
        })
      )
    ).catch(error => {
      console.error('[File Upload] Background processing error:', error)
    })

    console.log(`[File Upload] Triggered processing for ${createdFiles.length} files`)
  }

  return NextResponse.json({ files: createdFiles })
}
