import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb, type Db } from '@vibesboard/adapter-postgres/client'
import { agents as agentsTable } from '@vibesboard/adapter-postgres/schema'
import { patchAgentSchema } from '@vibesboard/agents/schema'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { getAgentById } from '@vibesboard/agents/server'
import { recordAgentVersion } from '@vibesboard/agents/versioning'
import {
  preserveNotificationSecret,
  sealNotificationConfig
} from '@vibesboard/agents/notification-secret'
import { deleteFile, isPermittedAgentFileKey } from '@vibesboard/adapter-s3'
import { assertSafeCallbackUrl } from '@vibesboard/agents/webhook-utils'
import { getFilesForAgent } from '@vibesboard/ai/files-store'
import { deleteFileEmbeddings } from '@vibesboard/ai/rag-store'
import { toPublicAgentResponse } from '@/lib/public-agent'

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

  // getAgentById reads through the BYPASSRLS migrate role and filters on the
  // agent id alone, so authentication is not enough here — without this check
  // any signed-in user could read any agent in any tenant, and the payload
  // includes accessPasswordHash (see agentRowToVibeAgent). Mirrors the guard
  // on GET /api/agents/[id]/versions.
  const canEdit = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  return NextResponse.json({ agent: toPublicAgentResponse(agent) })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  // Both of these used to throw out of the handler (SyntaxError / ZodError),
  // which Next reports as a 500 with no `error` body — so clearing the name in
  // the Setup tab (name is min(2)) surfaced a generic "server error" toast and
  // paged as a server fault. Malformed client input is a 400, same as POST
  // /api/agents.
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = patchAgentSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const payload = parsed.data

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
  const set: Record<string, unknown> = { updatedAt: new Date() }
  if (payload.name !== undefined) set.name = payload.name
  if (payload.instructions !== undefined)
    set.instructions = payload.instructions
  if (payload.fileKeys !== undefined) {
    // A caller may not attach another agent's file. Canonical objects are
    // exact-agent scoped; the only compatible legacy form is owned by the
    // agent owner.
    const invalid = payload.fileKeys.filter((k: string) =>
      !isPermittedAgentFileKey(k, agent.tenantId, agent.id, agent.userId)
    )
    if (invalid.length > 0) {
      return NextResponse.json(
        { error: 'fileKeys contains keys not owned by this agent' },
        { status: 400 }
      )
    }
    set.fileKeys = payload.fileKeys
  }
  if (payload.sourceUrls !== undefined) set.sourceUrls = payload.sourceUrls
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
  // llmConfigId is in patchAgentSchema and is sent by the Setup tab
  // (lib/hooks/use-agent-form.ts), but was never written here — the per-agent
  // provider override reported "Changes saved" and silently did nothing.
  // Nullable on purpose: null clears the override back to workspace routing.
  if (payload.llmConfigId !== undefined) set.llmConfigId = payload.llmConfigId
  if (payload.retrievalStrategy !== undefined)
    set.retrievalStrategy = payload.retrievalStrategy
  // The webhook secret is a live HMAC signing key — encrypt it before it is
  // written to the JSONB column. API responses intentionally omit the secret,
  // so retain it when the client saves unrelated notification settings.
  if (payload.notificationConfig !== undefined)
    set.notificationConfig = sealNotificationConfig(
      preserveNotificationSecret(
        agent.notificationConfig,
        payload.notificationConfig
      )
    )
  if (payload.handoffTargets !== undefined)
    set.handoffTargets = payload.handoffTargets
  if (payload.schedulingConfig !== undefined)
    set.schedulingConfig = payload.schedulingConfig
  if (payload.dataConfig !== undefined) set.dataConfig = payload.dataConfig
  if (payload.calendarAvailabilityConfig !== undefined)
    set.calendarAvailabilityConfig = payload.calendarAvailabilityConfig
  if (payload.bookingConfig !== undefined)
    set.bookingConfig = payload.bookingConfig
  if (typeof payload.memoryEnabled === 'boolean')
    set.memoryEnabled = payload.memoryEnabled

  try {
    await getMigrateDb().transaction(async tx => {
      await tx
        .update(agentsTable)
        .set(set as Partial<typeof agentsTable.$inferInsert>)
        .where(eq(agentsTable.id, id))
      // Snapshot the result as a new version (no-op if config is unchanged).
      await recordAgentVersion(tx as unknown as Db, id, {
        source: 'update',
        actor: authResult.user.id,
        note: payload.changeNote ?? null
      })
    })
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

  return NextResponse.json({ agent: toPublicAgentResponse(updated) })
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

  // Embedding source ids are intentionally polymorphic and have no FK to the
  // files table. Remove all file chunks in the same transaction as the agent
  // row so deleting an agent cannot strand permanent vector-store rows.
  try {
    await getMigrateDb().transaction(async tx => {
      const fileRows = await getFilesForAgent(id, tx as unknown as Db)
      for (const file of fileRows) {
        await deleteFileEmbeddings(agent.tenantId, file.id, tx as unknown as Db)
      }

      // FK cascade removes file rows, conversations, hooks, and links.
      await tx.delete(agentsTable).where(eq(agentsTable.id, id))
    })
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Delete failed',
      { status: 500 }
    )
  }

  // Database state is authoritative. Object deletion is best-effort after the
  // transaction so a transient S3 failure cannot leave live rows pointing to
  // already-deleted objects. Skip anything not owned by this exact agent — a
  // poisoned fileKeys entry must not let deletion wipe another agent's object.
  await Promise.all(
    (agent.fileKeys ?? [])
      .filter(fileKey =>
        isPermittedAgentFileKey(
          fileKey,
          agent.tenantId,
          agent.id,
          agent.userId
        )
      )
      .map(fileKey =>
        deleteFile(fileKey).catch(err =>
          console.error(`Error deleting file ${fileKey}:`, err)
        )
      )
  )

  return new NextResponse(null, { status: 204 })
}
