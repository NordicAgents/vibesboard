import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getSignedDownloadUrl } from '@/lib/firebase/storage'

export const runtime = 'nodejs'

/**
 * GET /api/agents/[id]/files/download-url?fileKey=...
 * Returns a signed download URL for a file in GCS
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params
  const session = await auth()
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const fileKey = req.nextUrl.searchParams.get('fileKey')
  if (!fileKey) {
    return NextResponse.json(
      { error: 'fileKey is required' },
      { status: 400 }
    )
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
