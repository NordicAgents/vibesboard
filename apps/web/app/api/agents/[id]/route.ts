import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { mapAgentDoc } from '@vibesboard/agents/db'
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

  // Find agent using collectionGroup query
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

  const updates: Record<string, any> = {
    ...(payload.name ? { name: payload.name } : {}),
    ...(payload.instructions ? { instructions: payload.instructions } : {}),
    ...(payload.fileKeys !== undefined ? { fileKeys: payload.fileKeys } : {}),
    ...(payload.tools !== undefined ? { tools: payload.tools } : {}),
    ...(typeof payload.allowAnonymous === 'boolean'
      ? { allowAnonymous: payload.allowAnonymous }
      : {}),
    ...(payload.greetingText !== undefined
      ? { greetingText: payload.greetingText }
      : {}),
    ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
    ...(payload.collectionFields !== undefined
      ? { collectionFields: payload.collectionFields }
      : {}),
    ...(payload.maxResponses !== undefined
      ? { maxResponses: payload.maxResponses }
      : {}),
    ...(payload.maxAgentResponses !== undefined
      ? { maxAgentResponses: payload.maxAgentResponses }
      : {}),
    ...(payload.quickSuggestionsMode !== undefined
      ? { quickSuggestionsMode: payload.quickSuggestionsMode }
      : {}),
    ...(payload.quickSuggestionsCount !== undefined
      ? { quickSuggestionsCount: payload.quickSuggestionsCount }
      : {}),
    ...(typeof payload.googleReviewEnabled === 'boolean'
      ? { googleReviewEnabled: payload.googleReviewEnabled }
      : {}),
    ...(payload.googlePlaceId !== undefined
      ? { googlePlaceId: payload.googlePlaceId }
      : {}),
    ...(payload.sourceUrls !== undefined
      ? { sourceUrls: payload.sourceUrls }
      : {}),
    ...(payload.domain !== undefined ? { domain: payload.domain } : {}),
    ...(payload.retrievalStrategy !== undefined
      ? { retrievalStrategy: payload.retrievalStrategy }
      : {}),
    ...(payload.notificationConfig !== undefined
      ? { notificationConfig: payload.notificationConfig }
      : {}),
    ...(payload.handoffTargets !== undefined
      ? { handoffTargets: payload.handoffTargets }
      : {}),
    ...(payload.schedulingConfig !== undefined
      ? { schedulingConfig: payload.schedulingConfig }
      : {}),
    ...(payload.dataConfig !== undefined
      ? { dataConfig: payload.dataConfig }
      : {}),
    ...(payload.calendarAvailabilityConfig !== undefined
      ? { calendarAvailabilityConfig: payload.calendarAvailabilityConfig }
      : {}),
    ...(payload.bookingConfig !== undefined
      ? { bookingConfig: payload.bookingConfig }
      : {}),
    updatedAt: new Date().toISOString()
  }

  const docRef = adminDb.collection(`tenants/${agent.tenantId}/agents`).doc(id)

  try {
    await docRef.update(updates)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to update agent'
      },
      { status: 500 }
    )
  }

  // Fetch the updated document
  const updatedDoc = await docRef.get()
  if (!updatedDoc.exists) {
    return NextResponse.json(
      { error: 'Unable to retrieve updated agent' },
      { status: 500 }
    )
  }

  return NextResponse.json({ agent: mapAgentDoc(updatedDoc.data()!) })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  // Find agent using collectionGroup query
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

  // Recursively delete the agent document and all subcollections
  // (conversations, bookings, hooks, etc.). Firestore does not cascade-delete
  // subcollections automatically — without this, all subcollection data
  // becomes orphaned and is never cleaned up.
  const docRef = adminDb.collection(`tenants/${agent.tenantId}/agents`).doc(id)

  try {
    await adminDb.recursiveDelete(docRef)
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Delete failed',
      { status: 500 }
    )
  }

  return new NextResponse(null, { status: 204 })
}
