import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { ingestFileForAgent } from '@vibesboard/ai/file-search'
import { getFileByKey } from '@vibesboard/ai/files-store'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const body = await req.json().catch(() => ({}))
  const fileKey = String(body?.fileKey ?? '').trim()
  const fileName =
    typeof body?.fileName === 'string' ? body.fileName : undefined
  const mimeType =
    typeof body?.mimeType === 'string' ? body.mimeType : undefined

  if (!fileKey) {
    return NextResponse.json(
      { error: 'fileKey is required for ingestion' },
      { status: 400 }
    )
  }

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

  const fileKeys = agent.fileKeys ?? []
  if (!fileKeys.includes(fileKey)) {
    return NextResponse.json(
      { error: 'fileKey is not attached to this agent' },
      { status: 400 }
    )
  }

  // Look up the file record to get the fileId
  const fileRecord = await getFileByKey(id, fileKey)
  if (!fileRecord) {
    return NextResponse.json(
      { error: 'File record not found for this agent and fileKey' },
      { status: 404 }
    )
  }

  try {
    const result = await ingestFileForAgent({
      tenantId: agent.tenantId,
      agentId: id,
      fileId: fileRecord.id,
      fileKey,
      fileName: fileName ?? fileRecord.fileName,
      mimeType: mimeType ?? fileRecord.mimeType
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
