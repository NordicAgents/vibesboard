import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  getDataConnection,
  deleteDataConnection,
  updateDataConnection
} from '@vibesboard/data/connections'
import { validateWebhookUrl } from '@vibesboard/data/validate-webhook-url'

export const runtime = 'nodejs'

/**
 * DELETE /api/data/connections/[id]
 * Remove a data connection.
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
      { error: 'Data actions feature is not enabled' },
      { status: 403 }
    )
  }

  const connection = await getDataConnection(tenantId, connectionId)
  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
  }

  await deleteDataConnection(tenantId, connectionId)

  return NextResponse.json({ success: true })
}

/**
 * PATCH /api/data/connections/[id]
 * Update connection settings (name, sheetName, tableId, etc.).
 */
export async function PATCH(
  req: Request,
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

  const body = await req.json()
  const allowedFields = [
    'name',
    'sheetName',
    'spreadsheetId',
    'tableId',
    'tableName',
    'webhookUrl',
    'webhookMethod',
    'webhookHeaders'
  ] as const

  const updates: Record<string, any> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field]
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'No valid fields to update' },
      { status: 400 }
    )
  }

  // Validate webhook URL if being updated
  if (updates.webhookUrl) {
    const urlValidation = validateWebhookUrl(updates.webhookUrl)
    if (!urlValidation.ok) {
      return NextResponse.json({ error: urlValidation.error }, { status: 400 })
    }
  }

  await updateDataConnection(tenantId, connectionId, updates)

  return NextResponse.json({ success: true })
}
