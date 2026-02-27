import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getSignedUploadUrl } from '@/lib/firebase/storage'

export const runtime = 'nodejs'

/**
 * POST /api/agents/[id]/files/upload-url
 * Returns a signed URL for direct browser → GCS upload
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params // ensure route params are available
  const session = await auth()
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { key, contentType } = await req.json()

  if (!key || !contentType) {
    return NextResponse.json(
      { error: 'key and contentType are required' },
      { status: 400 }
    )
  }

  try {
    const uploadUrl = await getSignedUploadUrl(key, contentType)
    return NextResponse.json({ uploadUrl })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? 'Failed to generate upload URL' },
      { status: 500 }
    )
  }
}
