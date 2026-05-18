import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  createDataConnection,
  getDataConnections
} from '@vibesboard/data/connections'
import { validateWebhookUrl } from '@vibesboard/data/validate-webhook-url'

export const runtime = 'nodejs'

/**
 * GET /api/data/connections
 * List all data connections for the active tenant.
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
    return NextResponse.json(
      { error: 'Data actions feature is not enabled' },
      { status: 403 }
    )
  }

  const connections = await getDataConnections(tenantId)

  // Strip encrypted tokens from the response
  const safe = connections.map(c => ({
    id: c.id,
    provider: c.provider,
    name: c.name,
    status: c.status,
    spreadsheetId: c.spreadsheetId,
    sheetName: c.sheetName,
    email: c.email,
    baseId: c.baseId,
    tableId: c.tableId,
    tableName: c.tableName,
    webhookUrl: c.webhookUrl,
    webhookMethod: c.webhookMethod,
    connectedBy: c.connectedBy,
    connectedAt: c.connectedAt,
    createdAt: c.createdAt
  }))

  return NextResponse.json({ connections: safe })
}

/**
 * POST /api/data/connections
 * Create a new Airtable or webhook connection (Google Sheets uses OAuth flow).
 */
export async function POST(req: Request) {
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

  const body = await req.json()
  const { provider, name } = body

  if (!provider || !name) {
    return NextResponse.json(
      { error: 'provider and name are required' },
      { status: 400 }
    )
  }

  try {
    let connection

    if (provider === 'airtable') {
      const { apiToken, baseId, tableId, tableName } = body
      if (!apiToken || !baseId || !tableId) {
        return NextResponse.json(
          { error: 'apiToken, baseId, and tableId are required for Airtable' },
          { status: 400 }
        )
      }
      connection = await createDataConnection({
        provider: 'airtable',
        tenantId,
        apiToken,
        baseId,
        tableId,
        tableName,
        connectedBy: user.id,
        name
      })
    } else if (provider === 'custom_webhook') {
      const { webhookUrl, webhookMethod, webhookHeaders } = body
      if (!webhookUrl) {
        return NextResponse.json(
          { error: 'webhookUrl is required for webhook connections' },
          { status: 400 }
        )
      }

      // Validate webhook URL to prevent SSRF
      const urlValidation = validateWebhookUrl(webhookUrl)
      if (!urlValidation.ok) {
        return NextResponse.json(
          { error: urlValidation.error },
          { status: 400 }
        )
      }
      connection = await createDataConnection({
        provider: 'custom_webhook',
        tenantId,
        webhookUrl,
        webhookMethod,
        webhookHeaders,
        connectedBy: user.id,
        name
      })
    } else {
      return NextResponse.json(
        { error: 'Use the OAuth flow for Google Sheets connections' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        id: connection.id,
        provider: connection.provider,
        name: connection.name,
        status: connection.status
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating data connection:', error)
    return NextResponse.json(
      { error: 'Failed to create connection' },
      { status: 500 }
    )
  }
}
