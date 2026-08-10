import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { agentFileKey, getSignedUploadUrl } from '@vibesboard/adapter-s3'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'

export const runtime = 'nodejs'

// Same allowlist as POST /api/files/upload-url. A presigned PUT lets the
// browser write whatever body it likes under the content type we sign, so the
// type has to be pinned to something the file processor can actually ingest.
const ACCEPTED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/svg+xml',
  'application/octet-stream'
])

/**
 * POST /api/agents/[id]/files/upload-url
 * Returns a signed URL for direct browser → S3 upload of a file for this agent.
 *
 * The key is caller-supplied, so it must be authorized against the agent in the
 * path — previously this route discarded the route params entirely and signed a
 * PUT for ANY key in the bucket for any authenticated user, so anyone with an
 * account could overwrite another tenant's knowledge-base documents.
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

  const { key, contentType } = await req.json()

  if (
    typeof key !== 'string' ||
    typeof contentType !== 'string' ||
    !key ||
    !contentType
  ) {
    return NextResponse.json(
      { error: 'key and contentType are required' },
      { status: 400 }
    )
  }

  if (!ACCEPTED_MIME_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: 'Unsupported file type' },
      { status: 400 }
    )
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

  // The key must land inside a prefix that belongs to this agent. Both prefixes
  // are derived from the agent row and never from the request body, so the
  // caller cannot steer the signed PUT at another tenant's objects:
  //   - the canonical scheme (packages/adapter-s3/src/keys.ts), and
  //   - the legacy owner-scoped prefix that the Knowledge tab still sends
  //     (components/agents/tools-files-manager.tsx) and that
  //     POST /api/files/upload-url mints for pre-agent-creation uploads.
  //     Drop this branch once those callers use the returned fileKey.
  const prefix = [
    agentFileKey(agent.tenantId, agent.id, ''),
    `${agent.userId}/`
  ].find(p => key.startsWith(p))
  const fileName = prefix ? key.slice(prefix.length) : ''

  // One traversal-free segment — same rule as POST /api/files/upload-url, so a
  // permitted prefix can't be escaped with `../` on the way back out.
  if (
    !fileName ||
    fileName.includes('..') ||
    fileName.includes('/') ||
    fileName.includes('\\')
  ) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    const uploadUrl = await getSignedUploadUrl(key, contentType)
    // fileKey is echoed back so callers can record the key that was actually
    // signed rather than re-deriving it client-side.
    return NextResponse.json({ uploadUrl, fileKey: key })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to generate upload URL' },
      { status: 500 }
    )
  }
}
