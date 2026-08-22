import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getSignedUploadUrl } from '@vibesboard/adapter-s3'
import {
  isAcceptedUploadMimeType,
  isValidUploadSize,
  MAX_FILE_UPLOAD_BYTES
} from '@/lib/file-upload'

export const runtime = 'nodejs'

/**
 * POST /api/files/upload-url
 * Returns a signed URL for direct browser → S3 upload (pre-agent creation).
 */
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { fileName, contentType, fileSize } = await req.json()

  if (!fileName || !contentType || fileSize === undefined) {
    return NextResponse.json(
      { error: 'fileName, contentType, and fileSize are required' },
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

  if (!isAcceptedUploadMimeType(contentType)) {
    return NextResponse.json(
      { error: 'Unsupported file type' },
      { status: 400 }
    )
  }

  if (!isValidUploadSize(fileSize)) {
    return NextResponse.json(
      {
        error: `File size must be between 1 byte and ${MAX_FILE_UPLOAD_BYTES} bytes`
      },
      { status: 413 }
    )
  }

  const fileKey = `${session.user.id}/${fileName}`

  try {
    const uploadUrl = await getSignedUploadUrl(
      fileKey,
      contentType,
      undefined,
      fileSize
    )
    return NextResponse.json({ uploadUrl, fileKey })
  } catch (error) {
    console.error('[file-upload] Failed to create signed upload URL', {
      error: error instanceof Error ? error.name : 'UnknownError'
    })
    return NextResponse.json(
      { error: 'Failed to generate upload URL' },
      { status: 500 }
    )
  }
}
