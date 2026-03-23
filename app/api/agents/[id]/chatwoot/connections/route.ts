import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { isFeatureEnabled } from '@/lib/features'
import {
  validateChatwootCredentials,
  listChatwootInboxes,
  createChatwootWebhook
} from '@/lib/chatwoot/api-client'
import {
  createChatwootConnection,
  listChatwootConnections,
  generateConnectionId,
  generateWebhookSecret
} from '@/lib/chatwoot/connections'

export const runtime = 'nodejs'

const CreateConnectionSchema = z.object({
  chatwootUrl: z.string().url('Invalid URL format'),
  apiToken: z.string().min(1, 'API token is required'),
  inboxId: z.number().int().positive('Invalid inbox ID')
})

type RouteParams = {
  params: Promise<{ id: string }>
}

async function findAgentWithOwnership(agentId: string, userId: string) {
  const snap = await adminDb
    .collectionGroup('agents')
    .where('id', '==', agentId)
    .where('userId', '==', userId)
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]
  const pathParts = doc.ref.path.split('/')
  const tenantId = pathParts[1]

  return { agent: doc.data(), tenantId }
}

/**
 * POST /api/agents/[id]/chatwoot/connections
 * Create a new Chatwoot connection for an agent.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: agentId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { tenantId } = agentResult

    const hasChatwoot = await isFeatureEnabled(tenantId, 'CHATWOOT')
    if (!hasChatwoot) {
      return NextResponse.json(
        { error: 'Chatwoot integration is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const validated = CreateConnectionSchema.parse(body)

    // 1. Validate credentials
    const credResult = await validateChatwootCredentials(
      validated.chatwootUrl,
      validated.apiToken
    )
    if (!credResult.valid) {
      return NextResponse.json(
        { error: `Invalid Chatwoot credentials: ${credResult.error}` },
        { status: 400 }
      )
    }

    // 2. Verify inbox exists
    const inboxes = await listChatwootInboxes(
      validated.chatwootUrl,
      validated.apiToken,
      credResult.accountId
    )
    const selectedInbox = inboxes.find(i => i.id === validated.inboxId)
    if (!selectedInbox) {
      return NextResponse.json(
        { error: 'Selected inbox not found in your Chatwoot account' },
        { status: 400 }
      )
    }

    // 3. Generate connection ID, webhook secret, and build URL
    const connectionId = generateConnectionId()
    const webhookSecret = generateWebhookSecret()

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000')
    const webhookUrl = `${appUrl}/api/webhooks/chatwoot/${connectionId}?secret=${webhookSecret}`

    // 4. Create webhook in Chatwoot
    let chatwootWebhookId: number | null = null
    try {
      const webhook = await createChatwootWebhook(
        validated.chatwootUrl,
        validated.apiToken,
        credResult.accountId,
        webhookUrl
      )
      chatwootWebhookId = webhook.id
    } catch (err) {
      console.error('[chatwoot] Failed to create webhook:', err)
      return NextResponse.json(
        {
          error:
            'Failed to create webhook in Chatwoot. Please ensure your token has permission to manage webhooks.'
        },
        { status: 400 }
      )
    }

    // 5. Store connection in Firestore
    const { connection } = await createChatwootConnection(
      tenantId,
      agentId,
      {
        chatwootUrl: validated.chatwootUrl,
        apiToken: validated.apiToken,
        accountId: credResult.accountId,
        inboxId: validated.inboxId,
        inboxName: selectedInbox.name,
        chatwootWebhookId,
        webhookSecret
      },
      auth.user.id,
      connectionId
    )

    const { encryptedApiToken, webhookSecretHash, ...safeConnection } = connection
    return NextResponse.json({ connection: safeConnection }, { status: 201 })
  } catch (error) {
    console.error('Error creating Chatwoot connection:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/agents/[id]/chatwoot/connections
 * List Chatwoot connections for an agent.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id: agentId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)
    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { tenantId } = agentResult

    const hasChatwoot = await isFeatureEnabled(tenantId, 'CHATWOOT')
    if (!hasChatwoot) {
      return NextResponse.json(
        { error: 'Chatwoot integration is not enabled for this tenant' },
        { status: 403 }
      )
    }

    const connections = await listChatwootConnections(tenantId, agentId)
    const safeConnections = connections.map(
      ({ encryptedApiToken, webhookSecretHash, ...rest }) => rest
    )

    return NextResponse.json({
      connections: safeConnections,
      total: safeConnections.length
    })
  } catch (error) {
    console.error('Error listing Chatwoot connections:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
