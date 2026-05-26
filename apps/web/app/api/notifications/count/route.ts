import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { countUnreadNotifications } from '@vibesboard/agents/notifications-db'
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

  const count = await countUnreadNotifications(tenantId)

  return NextResponse.json({ count })
}
