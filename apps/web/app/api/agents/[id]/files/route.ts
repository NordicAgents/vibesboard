import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { processFile } from '@vibesboard/ai/file-processor'
import { insertFiles, listFiles } from '@vibesboard/ai/files-store'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents } from '@vibesboard/adapter-postgres/schema'

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

  // Find agent via Postgres
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

  const { files, total } = await listFiles({
    tenantId: agent.tenantId,
    agentId: id,
    status: status ?? undefined,
    page,
    limit
  })

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

  // Find agent via Postgres
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
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  let createdFiles: Array<{
    id: string
    fileKey: string
    fileName: string
    mimeType: string
    status: string
    createdAt: string
  }>

  try {
    const records = await insertFiles(
      files.map(f => ({
        tenantId: agent.tenantId,
        agentId: id,
        userId: user.id,
        fileKey: f.fileKey,
        fileName: f.fileName,
        mimeType: f.mimeType,
        fileSize: f.fileSize
      }))
    )

    createdFiles = records.map(r => ({
      id: r.id,
      fileKey: r.fileKey,
      fileName: r.fileName,
      mimeType: r.mimeType,
      status: r.status,
      createdAt: r.createdAt
    }))
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create file records'
      },
      { status: 500 }
    )
  }

  // Update agent fileKeys array in Postgres (deduplicated)
  const currentFileKeys = agent.fileKeys ?? []
  const newFileKeys = files.map(f => f.fileKey)
  const updatedFileKeys = Array.from(
    new Set([...currentFileKeys, ...newFileKeys])
  )

  const db = getMigrateDb()
  await db
    .update(agents)
    .set({ fileKeys: updatedFileKeys, updatedAt: new Date() })
    .where(eq(agents.id, id))

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

    console.log(
      `[File Upload] Triggered processing for ${createdFiles.length} files`
    )
  }

  return NextResponse.json({ files: createdFiles })
}
