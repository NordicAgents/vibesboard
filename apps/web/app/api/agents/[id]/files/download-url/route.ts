import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import {
  getSignedDownloadUrl,
  isCrossTenantFileKey
} from '@vibesboard/adapter-s3'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

/**
 * GET /api/agents/[id]/files/download-url?fileKey=...
 * Returns a signed download URL for a file attached to this agent.
 *
 * The fileKey is caller-supplied, so it must be authorized against the agent
 * in the path — previously this route signed a URL for ANY key in the bucket
 * for any authenticated user, which exposed every tenant's knowledge-base
 * documents.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const fileKey = req.nextUrl.searchParams.get('fileKey')
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

  // The key must actually belong to this agent...
  if (!(agent.fileKeys ?? []).includes(fileKey)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  // ...and membership alone is not enough: the fileKeys array is caller-writable
  // (see PATCH), so a key poisoned into it that addresses another tenant's
  // namespace must still be refused here.
  if (isCrossTenantFileKey(fileKey, agent.tenantId)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const downloadUrl = await getSignedDownloadUrl(fileKey)
    return NextResponse.json({ downloadUrl })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to generate download URL' },
      { status: 500 }
    )
  }
}
