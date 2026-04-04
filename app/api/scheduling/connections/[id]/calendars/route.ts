import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import { getCalendarConnection, getValidAccessToken } from '@/lib/scheduling/connections'
import { listCalendars } from '@/lib/scheduling/google-auth'

export const runtime = 'nodejs'

/**
 * GET /api/scheduling/connections/[id]/calendars
 * Returns all calendars the user has write access to for a given connection.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_ACTIONS_SCHEDULE')
  if (!enabled) {
    return NextResponse.json({ error: 'Scheduling feature is not enabled' }, { status: 403 })
  }

  const connection = await getCalendarConnection(tenantId, connectionId)
  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  try {
    const accessToken = await getValidAccessToken(connection)
    const calendars = await listCalendars(accessToken)
    return NextResponse.json({ calendars })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list calendars' },
      { status: 500 }
    )
  }
}
