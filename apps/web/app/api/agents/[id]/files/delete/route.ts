import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { deleteFile } from '@vibesboard/adapter-s3'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

/**
 * POST /api/agents/[id]/files/delete
 * Deletes a file attached to this agent from storage.
 *
 * The fileKey is caller-supplied, so it must be authorized against the agent
 * in the path — previously this route deleted ANY key in the bucket for any
 * authenticated user, which allowed destroying every tenant's uploads.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { fileKey } = await req.json()
  if (!fileKey) {
    return NextResponse.json({ error: 'fileKey is required' }, { status: 400 })
  }

  const agent = await getAgentById(id)
  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // The key must actually belong to this agent.
  if (!(agent.fileKeys ?? []).includes(fileKey)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    await deleteFile(fileKey)
    return NextResponse.json({ status: 'ok' })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to delete file' },
      { status: 500 }
    )
  }
}
