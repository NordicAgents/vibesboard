import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@/lib/firebase/admin'
import { mapAgentDoc } from '@/lib/agents/db'
import { patchAgentSchema } from '@/lib/agents/schema'
import { canEditAgent } from '@/lib/agents/permissions'
import { getAgentById } from '@/lib/agents/server'
import { deleteFile } from '@/lib/firebase/storage'

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
    ...(payload.maxMessages !== undefined
      ? { maxMessages: payload.maxMessages }
      : {}),
    ...(payload.quickSuggestionsMode !== undefined
      ? { quickSuggestionsMode: payload.quickSuggestionsMode }
      : {}),
    ...(payload.quickSuggestionsCount !== undefined
      ? { quickSuggestionsCount: payload.quickSuggestionsCount }
      : {}),
    updatedAt: new Date().toISOString()
  }

  const docRef = adminDb
    .collection(`tenants/${agent.tenantId}/agents`)
    .doc(id)

  try {
    await docRef.update(updates)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to update agent' },
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

  // Clean up files from GCS
  if (agent.fileKeys && agent.fileKeys.length > 0) {
    await Promise.all(
      agent.fileKeys.map(fileKey =>
        deleteFile(fileKey).catch(err =>
          console.error(`Error deleting file ${fileKey}:`, err)
        )
      )
    )
  }

  // Delete the agent document
  const docRef = adminDb
    .collection(`tenants/${agent.tenantId}/agents`)
    .doc(id)

  try {
    await docRef.delete()
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Delete failed',
      { status: 500 }
    )
  }

  return new NextResponse(null, { status: 204 })
}
