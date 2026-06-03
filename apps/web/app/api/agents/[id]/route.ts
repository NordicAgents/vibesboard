import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { agents as agentsTable } from '@vibesboard/adapter-postgres/schema'
import { patchAgentSchema } from '@vibesboard/agents/schema'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { getAgentById } from '@vibesboard/agents/server'
import { deleteFile } from '@vibesboard/adapter-s3'
import { assertSafeCallbackUrl } from '@vibesboard/agents/webhook-utils'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json({ agent })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const body = await req.json()
  const payload = patchAgentSchema.parse(body)

  // Validate webhook URL against SSRF at save time
  const webhookUrl = payload.notificationConfig?.webhook?.url
  if (webhookUrl) {
    try {
      assertSafeCallbackUrl(webhookUrl)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid webhook URL' },
        { status: 400 }
      )
    }
  }

  // Validate handoff targets: no self-reference
  if (payload.handoffTargets?.length) {
    for (const targetId of payload.handoffTargets) {
      if (targetId === id) {
        return NextResponse.json(
          { error: 'Agent cannot hand off to itself' },
          { status: 400 }
        )
      }
    }
  }

  // Find agent
  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  // Validate that all handoff targets exist and are in the same tenant
  if (payload.handoffTargets?.length) {
    for (const targetId of payload.handoffTargets) {
      const target = await getAgentById(targetId)
      if (!target || target.tenantId !== agent.tenantId) {
        return NextResponse.json(
          { error: `Invalid handoff target: ${targetId}` },
          { status: 400 }
        )
      }
    }
  }

  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Build set object from payload — ONLY real columns.
  // NOTE: sourceUrls & domain intentionally NOT written — no such columns in agents table.
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (payload.name !== undefined) set.name = payload.name
  if (payload.instructions !== undefined)
    set.instructions = payload.instructions
  if (payload.fileKeys !== undefined) set.fileKeys = payload.fileKeys
  if (payload.tools !== undefined) set.tools = payload.tools
  if (typeof payload.allowAnonymous === 'boolean')
    set.allowAnonymous = payload.allowAnonymous
  if (payload.greetingText !== undefined)
    set.greetingText = payload.greetingText
  if (payload.mode !== undefined) set.mode = payload.mode
  if (payload.collectionFields !== undefined)
    set.collectionFields = payload.collectionFields
  if (payload.maxResponses !== undefined)
    set.maxResponses = payload.maxResponses
  if (payload.maxAgentResponses !== undefined)
    set.maxAgentResponses = payload.maxAgentResponses
  if (payload.quickSuggestionsMode !== undefined)
    set.quickSuggestionsMode = payload.quickSuggestionsMode
  if (payload.quickSuggestionsCount !== undefined)
    set.quickSuggestionsCount = payload.quickSuggestionsCount
  if (typeof payload.googleReviewEnabled === 'boolean')
    set.googleReviewEnabled = payload.googleReviewEnabled
  if (payload.googlePlaceId !== undefined)
    set.googlePlaceId = payload.googlePlaceId
  if (payload.retrievalStrategy !== undefined)
    set.retrievalStrategy = payload.retrievalStrategy
  if (payload.notificationConfig !== undefined)
    set.notificationConfig = payload.notificationConfig
  if (payload.handoffTargets !== undefined)
    set.handoffTargets = payload.handoffTargets
  if (payload.schedulingConfig !== undefined)
    set.schedulingConfig = payload.schedulingConfig
  if (payload.dataConfig !== undefined) set.dataConfig = payload.dataConfig
  if (payload.calendarAvailabilityConfig !== undefined)
    set.calendarAvailabilityConfig = payload.calendarAvailabilityConfig
  if (payload.bookingConfig !== undefined)
    set.bookingConfig = payload.bookingConfig

  try {
    await getMigrateDb()
      .update(agentsTable)
      .set(set as Partial<typeof agentsTable.$inferInsert>)
      .where(eq(agentsTable.id, id))
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to update agent'
      },
      { status: 500 }
    )
  }

  const updated = await getAgentById(id)
  if (!updated) {
    return NextResponse.json(
      { error: 'Unable to retrieve updated agent' },
      { status: 500 }
    )
  }

  return NextResponse.json({ agent: updated })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  // Find agent
  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Clean up files from storage
  if (agent.fileKeys && agent.fileKeys.length > 0) {
    await Promise.all(
      agent.fileKeys.map(fileKey =>
        deleteFile(fileKey).catch(err =>
          console.error(`Error deleting file ${fileKey}:`, err)
        )
      )
    )
  }

  // Delete the agent row — FK cascade removes conversations/hooks/links.
  try {
    await getMigrateDb().delete(agentsTable).where(eq(agentsTable.id, id))
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Delete failed',
      { status: 500 }
    )
  }

  return new NextResponse(null, { status: 204 })
}
