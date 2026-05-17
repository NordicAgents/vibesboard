import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { deleteFile } from '@vibesboard/adapter-firebase/storage'

export const runtime = 'nodejs'

/**
 * POST /api/agents/[id]/files/delete
 * Deletes a file from GCS
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params
  const session = await auth()
  if (!session?.user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { fileKey } = await req.json()
  if (!fileKey) {
    return NextResponse.json({ error: 'fileKey is required' }, { status: 400 })
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
