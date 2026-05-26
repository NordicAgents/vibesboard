import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import {
  validateChatwootCredentials,
  listChatwootInboxes
} from '@vibesboard/channel-chatwoot/api-client'

export const runtime = 'nodejs'

const ValidateSchema = z.object({
  chatwootUrl: z.string().url('Invalid URL format'),
  apiToken: z.string().min(1, 'API token is required')
})

type RouteParams = {
  params: Promise<{ id: string }>
}

/**
 * Find agent and verify ownership (same pattern as whatsapp routes).
 */
async function findAgentWithOwnership(agentId: string, userId: string) {
  const agent = await getAgentById(agentId)
  if (!agent || agent.userId !== userId) return null
  return { agent, tenantId: agent.tenantId }
}

/**
 * POST /api/agents/[id]/chatwoot/validate
 * Validate Chatwoot credentials and return available inboxes.
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
    const validated = ValidateSchema.parse(body)

    // Validate credentials
    const result = await validateChatwootCredentials(
      validated.chatwootUrl,
      validated.apiToken
    )

    if (!result.valid) {
      return NextResponse.json(
        { valid: false, error: result.error },
        { status: 400 }
      )
    }

    // Fetch available inboxes
    const inboxes = await listChatwootInboxes(
      validated.chatwootUrl,
      validated.apiToken,
      result.accountId
    )

    return NextResponse.json({
      valid: true,
      accountId: result.accountId,
      name: result.name,
      inboxes
    })
  } catch (error) {
    console.error('Error validating Chatwoot credentials:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to validate credentials' },
      { status: 500 }
    )
  }
}
