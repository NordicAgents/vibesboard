import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import {
  createConnection,
  listAgentConnections
} from '@/lib/whatsapp/connections'
import { sendIntroductionMessage } from '@/lib/whatsapp/intro-message'
import { isFeatureEnabled } from '@/lib/features'
import { z } from 'zod'

export const runtime = 'nodejs'

const CreateConnectionSchema = z.object({
  phoneNumber: z
    .string()
    .regex(
      /^\+[1-9]\d{7,14}$/,
      'Invalid phone number format. Use E.164 format (e.g., +919400293288)'
    ),
  customIntroMessage: z.string().optional(),
  sendIntroImmediately: z.boolean().default(true),
  expiresAt: z.string().datetime().optional()
})

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * Find an agent by ID using collectionGroup query, verifying ownership.
 * Returns the agent data and tenantId, or null if not found / not owned.
 */
async function findAgentWithOwnership(agentId: string, userId: string) {
  const snap = await adminDb
    .collectionGroup('agents')
    .where('id', '==', agentId)
    .where('userId', '==', userId)
    .limit(1)
    .get()

  if (snap.empty) return null

  const doc = snap.docs[0]
  // Path: tenants/{tenantId}/agents/{agentId}
  const pathParts = doc.ref.path.split('/')
  const tenantId = pathParts[1]

  return { agent: doc.data(), tenantId, ref: doc.ref }
}

/**
 * POST /api/agents/[id]/whatsapp/connections
 * Create new WhatsApp connection for agent
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: agentId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    // Verify agent ownership
    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)

    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { agent, tenantId } = agentResult

    // Check feature flag
    const hasWhatsApp = await isFeatureEnabled(tenantId, 'WHATSAPP_MESSAGING')
    if (!hasWhatsApp) {
      return NextResponse.json(
        { error: 'WhatsApp Messaging is not enabled for this tenant' },
        { status: 403 }
      )
    }

    // Parse and validate request body
    const body = await request.json()
    const validated = CreateConnectionSchema.parse(body)

    // Create connection
    const connection = await createConnection(
      tenantId,
      agentId,
      {
        agentId,
        phoneNumber: validated.phoneNumber,
        customIntroMessage: validated.customIntroMessage,
        expiresAt: validated.expiresAt
          ? new Date(validated.expiresAt)
          : undefined
      },
      auth.user.id
    )

    if (!connection) {
      return NextResponse.json(
        { error: 'Failed to create connection' },
        { status: 500 }
      )
    }

    // Send introduction message if requested
    let introMessageSent = false
    if (validated.sendIntroImmediately) {
      introMessageSent = await sendIntroductionMessage(connection, agent as any)
    }

    return NextResponse.json(
      {
        connection,
        introMessageSent
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Error creating WhatsApp connection:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/agents/[id]/whatsapp/connections?status=active
 * List WhatsApp connections for agent
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { id: agentId } = await params

    const auth = await requireAuth()
    if (!auth.ok) return auth.response

    // Verify agent ownership
    const agentResult = await findAgentWithOwnership(agentId, auth.user.id)

    if (!agentResult) {
      return NextResponse.json(
        { error: 'Agent not found or unauthorized' },
        { status: 404 }
      )
    }

    const { tenantId } = agentResult

    // Check feature flag
    const hasWhatsApp = await isFeatureEnabled(tenantId, 'WHATSAPP_MESSAGING')
    if (!hasWhatsApp) {
      return NextResponse.json(
        { error: 'WhatsApp Messaging is not enabled for this tenant' },
        { status: 403 }
      )
    }

    // Get status filter from query params
    const status = request.nextUrl.searchParams.get('status') || undefined

    // List connections
    const connections = await listAgentConnections(tenantId, agentId, status)

    return NextResponse.json({
      connections,
      total: connections.length
    })
  } catch (error) {
    console.error('Error listing WhatsApp connections:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
