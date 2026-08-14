import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { isCrossTenantFileKey } from '@vibesboard/adapter-s3'
import { processFile } from '@vibesboard/ai/file-processor'
import { insertFiles, listFiles } from '@vibesboard/ai/files-store'
import { resolveProviderSpec } from '@vibesboard/ai/tenant-llm-config'
import { shouldResolveTenantProvider } from '@vibesboard/ai/provider-routing'
import { getMigrateDb, type Db } from '@vibesboard/adapter-postgres/client'
import { agents } from '@vibesboard/adapter-postgres/schema'
import { recordAgentVersion } from '@vibesboard/agents/versioning'

export const runtime = 'nodejs'

/**
 * GET /api/agents/[id]/files
 * List all files for an agent with processing status
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  // Find agent via Postgres
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

  // Get query params
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page = parseInt(searchParams.get('page') || '1')
  const limit = parseInt(searchParams.get('limit') || '20')

  const { files, total } = await listFiles({
    tenantId: agent.tenantId,
    agentId: id,
    status: status ?? undefined,
    page,
    limit
  })

  // Resolve the provider embedding would actually use, the same way
  // ingestFileForAgent does — honoring an `embed` task assignment rather than
  // assuming the workspace default. The client used to derive this itself from
  // the default enabled config, which was wrong in both directions: it missed
  // a config task-routed to `embed`, and it flagged a default change that
  // never touched embeddings.
  let currentEmbeddingProvider: string | null = null
  try {
    const spec = shouldResolveTenantProvider({ tenantId: agent.tenantId })
      ? await resolveProviderSpec(agent.tenantId, null, undefined, 'embed')
      : null
    currentEmbeddingProvider = spec?.kind ?? 'openai'
  } catch {
    // Never fail the file list over this — the banner is advisory, and a null
    // simply means "can't tell", which the client treats as not-stale.
    currentEmbeddingProvider = null
  }

  return NextResponse.json({
    files,
    currentEmbeddingProvider,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  })
}

/**
 * POST /api/agents/[id]/files
 * Upload new files to an existing agent
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user

  // Find agent via Postgres
  const agent = await getAgentById(id)

  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })

  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // Parse request body
  const body = await req.json()
  const files: Array<{
    fileKey: string
    fileName: string
    fileSize: number
    mimeType: string
  }> = body.files || []

  if (!files.length) {
    return NextResponse.json({ error: 'No files provided' }, { status: 400 })
  }

  // fileKey is caller-supplied here; refuse any key that reaches into another
  // tenant's namespace before it is written to the files table or merged into
  // the agent's fileKeys array.
  if (files.some(f => isCrossTenantFileKey(f.fileKey, agent.tenantId))) {
    return NextResponse.json(
      { error: 'fileKey outside this tenant' },
      { status: 400 }
    )
  }

  let createdFiles: Array<{
    id: string
    fileKey: string
    fileName: string
    mimeType: string
    status: string
    createdAt: string
  }>

  try {
    const records = await insertFiles(
      files.map(f => ({
        tenantId: agent.tenantId,
        agentId: id,
        userId: user.id,
        fileKey: f.fileKey,
        fileName: f.fileName,
        mimeType: f.mimeType,
        fileSize: f.fileSize
      }))
    )

    createdFiles = records.map(r => ({
      id: r.id,
      fileKey: r.fileKey,
      fileName: r.fileName,
      mimeType: r.mimeType,
      status: r.status,
      createdAt: r.createdAt
    }))
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to create file records'
      },
      { status: 500 }
    )
  }

  // Update agent fileKeys array in Postgres (deduplicated). Read-modify-write
  // happens inside the transaction under a row lock so concurrent uploads for
  // the same agent serialize instead of racing on a stale fileKeys read.
  const newFileKeys = files.map(f => f.fileKey)
  await getMigrateDb().transaction(async tx => {
    const [row] = await tx
      .select({ fileKeys: agents.fileKeys })
      .from(agents)
      .where(eq(agents.id, id))
      .for('update')
    const currentFileKeys = row?.fileKeys ?? []
    const updatedFileKeys = Array.from(
      new Set([...currentFileKeys, ...newFileKeys])
    )

    // updatedAt always bumps — a files-sync request just completed against
    // this agent — but fileKeys is only rewritten when it actually changed.
    await tx
      .update(agents)
      .set({
        ...(updatedFileKeys.length !== currentFileKeys.length
          ? { fileKeys: updatedFileKeys }
          : {}),
        updatedAt: new Date()
      })
      .where(eq(agents.id, id))

    // No-ops internally when the resulting config snapshot is unchanged.
    await recordAgentVersion(tx as unknown as Db, id, {
      source: 'file-sync',
      actor: user.id,
      note: 'Files added'
    })
  })

  // Trigger background processing (non-blocking)
  if (createdFiles.length > 0) {
    Promise.all(
      createdFiles.map(file =>
        processFile({
          fileId: file.id,
          agentId: id,
          tenantId: agent.tenantId,
          fileKey: file.fileKey,
          fileName: file.fileName,
          mimeType: file.mimeType || 'application/octet-stream'
        })
      )
    ).catch(error => {
      console.error('[File Upload] Background processing error:', error)
    })

    console.log(
      `[File Upload] Triggered processing for ${createdFiles.length} files`
    )
  }

  return NextResponse.json({ files: createdFiles })
}
