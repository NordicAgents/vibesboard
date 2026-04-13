import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import {
  getDataConnection,
  getValidDataAccessToken
} from '@/lib/data/connections'
import { createDataProvider } from '@/lib/data/providers'

export const runtime = 'nodejs'

/**
 * POST /api/data/connections/[id]/test
 * Test a data connection to verify it's working.
 */
export async function POST(
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
      { error: 'Data actions feature is not enabled' },
      { status: 403 }
    )
  }

  const connection = await getDataConnection(tenantId, connectionId)
  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  try {
    const accessToken = await getValidDataAccessToken(connection)
    const provider = createDataProvider(connection, accessToken)
    const result = await provider.testConnection()

    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Test failed'
    })
  }
}
