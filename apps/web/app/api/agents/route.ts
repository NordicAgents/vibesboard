import { NextResponse } from 'next/server'

import { requireAuth } from '@/lib/firebase/route-handler'
import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { mapAgentDoc, createAgentSlug, ensureUniqueSlug } from '@vibesboard/agents/db'
import { isMemberOfTenant, isSuperAdmin } from '@vibesboard/policy/permissions'
import { getActiveTenant, getTenantById } from '@/lib/tenant-context'
import { upsertAgentSchema } from '@vibesboard/agents/schema'
import { createAgentFilesAndTriggerProcessing } from '@vibesboard/agents/file-processing'
import { nanoid } from '@vibesboard/utils'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  const { searchParams } = new URL(req.url)
  const tenantId = searchParams.get('tenant_id')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '9')
  const from = (page - 1) * limit

  const isSuperAdminUser = tenantId ? await isSuperAdmin(user.id) : false

  if (tenantId && !isSuperAdminUser) {
    const isMember = await isMemberOfTenant(user.id, tenantId)
    if (!isMember) {
      return new NextResponse('Forbidden', { status: 403 })
    }
  }

  // Build the Firestore query
  let baseQuery: FirebaseFirestore.Query = adminDb
    .collection(Collections.agents(tenantId!))
    .orderBy('createdAt', 'desc')

  if (!tenantId) {
    // Fallback: show agents created by the user across all tenants
    baseQuery = adminDb
      .collectionGroup('agents')
      .where('userId', '==', user.id)
      .orderBy('createdAt', 'desc')
  }

  // Get total count
  const countSnapshot = await baseQuery.count().get()
  const total = countSnapshot.data().count

  // Apply pagination
  const snapshot = await baseQuery.offset(from).limit(limit).get()

  const agents = snapshot.docs.map(doc => mapAgentDoc(doc.data()))

  return NextResponse.json({
    agents,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  })
}

export async function POST(req: Request) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  const body = await req.json()
  const payload = upsertAgentSchema.parse(body)

  // Resolve the tenant the new agent should belong to.
  const tenantId = await getActiveTenant(user.id)

  if (!tenantId) {
    return NextResponse.json(
      {
        error:
          'No tenant available for this user; ensure tenant membership exists.'
      },
      { status: 400 }
    )
  }

  // Look up the tenant slug for URL construction
  const tenant = await getTenantById(tenantId)
  const tenantSlug = tenant?.slug ?? 'unknown'

  const slug = await ensureUniqueSlug(createAgentSlug(payload.name), tenantId)

  const now = new Date().toISOString()
  const newId = nanoid()
  const docRef = adminDb.collection(Collections.agents(tenantId)).doc(newId)

  const agentData = {
    id: newId,
    userId: user.id,
    tenantId,
    tenantSlug,
    name: payload.name,
    instructions: payload.instructions,
    fileKeys: payload.fileKeys ?? [],
    tools: payload.tools ?? [],
    allowAnonymous: payload.allowAnonymous ?? false,
    agentUrl: slug,
    ...(payload.greetingText !== undefined && {
      greetingText: payload.greetingText
    }),
    mode: payload.mode ?? 'provider',
    collectionFields: payload.collectionFields ?? [],
    ...(payload.maxResponses !== undefined && {
      maxResponses: payload.maxResponses
    }),
    ...(payload.maxAgentResponses !== undefined && {
      maxAgentResponses: payload.maxAgentResponses
    }),
    totalResponseCount: 0,
    quickSuggestionsMode: payload.quickSuggestionsMode ?? 'off',
    quickSuggestionsCount: payload.quickSuggestionsCount ?? 4,
    sourceUrls: payload.sourceUrls ?? [],
    domain: payload.domain ?? null,
    retrievalStrategy: payload.retrievalStrategy ?? 'direct',
    ...(payload.notificationConfig !== undefined && {
      notificationConfig: payload.notificationConfig
    }),
    ...(payload.handoffTargets !== undefined && {
      handoffTargets: payload.handoffTargets
    }),
    ...(payload.schedulingConfig !== undefined && {
      schedulingConfig: payload.schedulingConfig
    }),
    ...(payload.dataConfig !== undefined && {
      dataConfig: payload.dataConfig
    }),
    ...(payload.calendarAvailabilityConfig !== undefined && {
      calendarAvailabilityConfig: payload.calendarAvailabilityConfig
    }),
    ...(payload.bookingConfig !== undefined && {
      bookingConfig: payload.bookingConfig
    }),
    createdAt: now,
    updatedAt: now
  }

  try {
    await docRef.set(agentData)
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to create agent'
      },
      { status: 500 }
    )
  }

  const agent = mapAgentDoc(agentData)

  // Auto-create agent_files entries for uploaded files (RAG Phase 1)
  if (payload.fileKeys && payload.fileKeys.length > 0) {
    await createAgentFilesAndTriggerProcessing({
      agentId: agent.id,
      tenantId,
      userId: user.id,
      fileKeys: payload.fileKeys
    })
  }

  return NextResponse.json({ agent })
}
