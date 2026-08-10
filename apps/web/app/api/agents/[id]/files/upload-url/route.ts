import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { agentFileKey, getSignedUploadUrl } from '@vibesboard/adapter-s3'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import {
  isAcceptedUploadMimeType,
  isValidUploadSize,
  MAX_FILE_UPLOAD_BYTES
} from '@/lib/file-upload'

export const runtime = 'nodejs'

/**
 * POST /api/agents/[id]/files/upload-url
 * Returns a signed URL for direct browser → S3 upload of a file for this agent.
 *
 * The server mints a tenant/agent-scoped object key after checking edit access;
 * callers cannot choose a storage key or overwrite another tenant's document.
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

  const { fileName, contentType, fileSize } = await req.json()

  if (
    typeof fileName !== 'string' ||
    typeof contentType !== 'string' ||
    !fileName ||
    !contentType ||
    fileSize === undefined
  ) {
    return NextResponse.json(
      { error: 'fileName, contentType, and fileSize are required' },
      { status: 400 }
    )
  }

  if (!isAcceptedUploadMimeType(contentType)) {
    return NextResponse.json(
      { error: 'Unsupported file type' },
      { status: 400 }
    )
  }

  if (!isValidUploadSize(fileSize)) {
    return NextResponse.json(
      { error: `File size must be between 1 byte and ${MAX_FILE_UPLOAD_BYTES} bytes` },
      { status: 413 }
    )
  }

  // Traversal / injection guard runs before any DB access so a malformed
  // filename can't be used to probe the agent's existence via timing.
  // (fileName is guaranteed non-empty by the earlier typeof check.)
  if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 })
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

  const fileKey = agentFileKey(agent.tenantId, agent.id, fileName)

  try {
    const uploadUrl = await getSignedUploadUrl(
      fileKey,
      contentType,
      undefined,
      fileSize
    )
    return NextResponse.json({ uploadUrl, fileKey })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to generate upload URL' },
      { status: 500 }
    )
  }
}
