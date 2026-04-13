import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getActiveTenant } from '@/lib/tenant-context'

export const runtime = 'nodejs'

/**
 * GET /api/notifications?unread=true&limit=20
 * List notifications for the user's active tenant.
 */
export async function GET(req: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) {
    return NextResponse.json({ notifications: [] })
  }

  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unread') === 'true'
  const limit = Math.min(Number(url.searchParams.get('limit') || '20'), 50)

  let query = adminDb
    .collection(Collections.notifications(tenantId))
    .orderBy('createdAt', 'desc')
    .limit(limit)

  if (unreadOnly) {
    query = query.where('read', '==', false)
  }

  const snapshot = await query.get()
  const notifications = snapshot.docs.map(
    (doc: FirebaseFirestore.QueryDocumentSnapshot) => doc.data()
  )

  return NextResponse.json({ notifications })
}

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50)
})

/**
 * PATCH /api/notifications
 * Mark notifications as read.
 */
export async function PATCH(req: NextRequest) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) {
    return new NextResponse('No active tenant', { status: 400 })
  }

  const body = await req.json()
  const parsed = markReadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const batch = adminDb.batch()
  const collRef = adminDb.collection(Collections.notifications(tenantId))

  for (const id of parsed.data.ids) {
    batch.update(collRef.doc(id), { read: true })
  }

  await batch.commit()

  return NextResponse.json({ ok: true })
}
