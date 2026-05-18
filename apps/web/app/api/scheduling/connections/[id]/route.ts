import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  getCalendarConnection,
  deleteCalendarConnection
} from '@vibesboard/scheduling/connections'
import { disableAgentsForConnection } from '@vibesboard/agents/server'

export const runtime = 'nodejs'

/**
 * DELETE /api/scheduling/connections/[id]
 * Remove a calendar connection.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: connectionId } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user
  const tenantId = await getActiveTenant(user.id)

  if (!tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_ACTIONS')
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

  await deleteCalendarConnection(tenantId, connectionId)

  // Disable any agents that referenced this connection so they don't silently
  // hold a dead reference — owner sees the toggle is off and knows to reconnect.
  await disableAgentsForConnection(tenantId, connectionId).catch(err =>
    console.error(
      '[connections/delete] Failed to disable agents for connection:',
      err
    )
  )

  return NextResponse.json({ success: true })
}
