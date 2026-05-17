import { NextRequest, NextResponse } from 'next/server'
import { adminDb } from '@vibesboard/adapter-firebase/admin'

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

  const doc = await adminDb
    .collection('meta_data_deletion_requests')
    .doc(id)
    .get()

  if (!doc.exists) {
    return NextResponse.json(
      { error: 'Deletion request not found' },
      { status: 404 }
    )
  }

  const data = doc.data()!
  return NextResponse.json({
    confirmation_code: data.confirmationCode,
    status: data.status,
    created_at: data.createdAt?.toDate?.()?.toISOString() ?? null,
    completed_at: data.completedAt?.toDate?.()?.toISOString() ?? null
  })
}
