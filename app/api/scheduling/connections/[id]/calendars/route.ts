import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import {
  getCalendarConnection,
  getValidAccessToken
} from '@/lib/scheduling/connections'
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
    return NextResponse.json(
      { error: 'Scheduling feature is not enabled' },
      { status: 403 }
    )
  }

  const connection = await getCalendarConnection(tenantId, connectionId)
  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  if (connection.status !== 'active') {
    return NextResponse.json(
      {
        error: 'Calendar connection is not active',
        code: 'CONNECTION_INACTIVE'
      },
      { status: 400 }
    )
  }

  try {
    const accessToken = await getValidAccessToken(connection)
    const calendars = await listCalendars(accessToken)
    return NextResponse.json({ calendars })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    if (
      message.toLowerCase().includes('token') ||
      message.toLowerCase().includes('refresh')
    ) {
      return NextResponse.json(
        {
          error: 'Calendar connection expired — please reconnect',
          code: 'TOKEN_EXPIRED'
        },
        { status: 401 }
      )
    }

    if (
      message.toLowerCase().includes('permission') ||
      message.toLowerCase().includes('forbidden')
    ) {
      return NextResponse.json(
        {
          error: 'Permission denied by Google Calendar',
          code: 'PERMISSION_DENIED'
        },
        { status: 403 }
      )
    }

    if (message.toLowerCase().includes('timed out')) {
      return NextResponse.json(
        {
          error: 'Google Calendar API timed out — please try again',
          code: 'TIMEOUT'
        },
        { status: 503 }
      )
    }

    console.error('[calendars/route] Failed to list calendars:', message)
    return NextResponse.json(
      { error: 'Failed to list calendars', code: 'UNKNOWN' },
      { status: 500 }
    )
  }
}
