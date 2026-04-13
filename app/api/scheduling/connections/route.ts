import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import { getCalendarConnections } from '@/lib/scheduling/connections'

export const runtime = 'nodejs'

/**
 * GET /api/scheduling/connections
 * List all calendar connections for the active tenant.
 */
export async function GET() {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user
  const tenantId = await getActiveTenant(user.id)

  if (!tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_ACTIONS')
  if (!enabled) {
    return NextResponse.json({ error: 'Scheduling feature is not enabled' }, { status: 403 })
  }

  const connections = await getCalendarConnections(tenantId)

  // Strip encrypted tokens from the response
  const safe = connections.map(c => ({
    id: c.id,
    provider: c.provider,
    name: c.name,
    calendarId: c.calendarId,
    email: c.email,
    status: c.status,
    connectedBy: c.connectedBy,
    connectedAt: c.connectedAt,
    createdAt: c.createdAt
  }))

  return NextResponse.json({ connections: safe })
}
