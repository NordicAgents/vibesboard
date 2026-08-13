import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { files as filesTable } from '@vibesboard/adapter-postgres/schema'
import { ingestFileForAgent } from '@vibesboard/ai/file-search'

export const runtime = 'nodejs'

/**
 * POST /api/agents/[id]/reembed
 * Re-embed all indexed files for an agent using the tenant's current provider.
 * Called when the tenant switches LLM provider and existing embeddings are stale.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent)
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (
    !(await canEditAgent({
      sessionUserId: authResult.user.id,
      agentOwnerId: agent.userId,
      tenantId: agent.tenantId
    }))
  ) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getMigrateDb()
  const agentFiles = await db
    .select()
    .from(filesTable)
    .where(eq(filesTable.agentId, id))

  const indexed = agentFiles.filter(f => f.status === 'indexed')
  if (!indexed.length) {
    return NextResponse.json({
      reembedded: 0,
      message: 'No indexed files to re-embed.'
    })
  }

  let reembedded = 0
  const errors: string[] = []

  for (const file of indexed) {
    try {
      const result = await ingestFileForAgent({
        tenantId: file.tenantId,
        agentId: file.agentId,
        fileId: file.id,
        fileKey: file.fileKey,
        fileName: file.fileName,
        mimeType: file.mimeType
      })
      if (result.chunksInserted === 0) {
        errors.push(
          `${file.fileName}: ${result.message ?? 'Ingestion produced no searchable chunks.'}`
        )
        continue
      }
      reembedded++
    } catch (err: any) {
      errors.push(`${file.fileName}: ${err?.message ?? 'unknown error'}`)
    }
  }

  return NextResponse.json({
    reembedded,
    total: indexed.length,
    errors,
    message: errors.length
      ? `Re-embedded ${reembedded}/${indexed.length} files. ${errors.length} failed.`
      : `Successfully re-embedded ${reembedded} file(s).`
  })
}
