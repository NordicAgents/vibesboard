import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getSignedUploadUrl } from '@/lib/firebase/storage'

export const runtime = 'nodejs'

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
 * POST /api/files/upload-url
 * Returns a signed URL for direct browser → GCS upload (pre-agent creation).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { fileName, contentType } = await req.json()

  if (!fileName || !contentType) {
    return NextResponse.json(
      { error: 'fileName and contentType are required' },
      { status: 400 }
    )
  }

  if (
    typeof fileName !== 'string' ||
    fileName.includes('..') ||
    fileName.includes('/') ||
    fileName.includes('\\')
  ) {
    return NextResponse.json({ error: 'Invalid file name' }, { status: 400 })
  }

  if (!ACCEPTED_MIME_TYPES.has(contentType)) {
    return NextResponse.json(
      { error: 'Unsupported file type' },
      { status: 400 }
    )
  }

  const fileKey = `${session.user.id}/${fileName}`

  try {
    const uploadUrl = await getSignedUploadUrl(fileKey, contentType)
    return NextResponse.json({ uploadUrl, fileKey })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to generate upload URL' },
      { status: 500 }
    )
  }
}
