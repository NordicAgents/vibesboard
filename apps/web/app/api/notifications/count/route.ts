import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { getActiveTenant } from '@/lib/tenant-context'

export const runtime = 'nodejs'

/**
 * GET /api/notifications/count
 * Return unread notification count for the user's active tenant.
 */
export async function GET() {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) {
    return NextResponse.json({ count: 0 })
  }

  const snapshot = await adminDb
    .collection(Collections.notifications(tenantId))
    .where('read', '==', false)
    .count()
    .get()

  return NextResponse.json({ count: snapshot.data().count })
}
