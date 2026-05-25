import { NextRequest, NextResponse } from 'next/server'
import { getDeletionRequest } from '@vibesboard/channel-instagram/data-deletion'

export const runtime = 'nodejs'

/**
 * GET — Check data deletion request status
 * Used by the deletion-status page and by Meta to verify progress.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
  }

  const record = await getDeletionRequest(id)

  if (!record) {
    return NextResponse.json(
      { error: 'Deletion request not found' },
      { status: 404 }
    )
  }

  return NextResponse.json({
    confirmation_code: record.confirmationCode,
    status: record.status,
    created_at: record.createdAt?.toISOString() ?? null,
    completed_at: record.completedAt?.toISOString() ?? null
  })
}
