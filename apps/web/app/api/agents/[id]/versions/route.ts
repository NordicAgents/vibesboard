import { NextRequest, NextResponse } from 'next/server'
import { inArray } from 'drizzle-orm'

import { requireAuth } from '@/lib/auth/route-handler'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import { users as usersTable } from '@vibesboard/adapter-postgres/schema'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import {
  listAgentVersions,
  getAgentCurrentVersion
} from '@vibesboard/agents/versioning'

export const runtime = 'nodejs'

/**
 * GET /api/agents/[id]/versions
 * List an agent's config version history (newest first). Config bodies are
 * omitted here — fetch a single version for the full snapshot.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

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

  const { searchParams } = new URL(req.url)
  const parsedPage = parseInt(searchParams.get('page') || '1', 10)
  const parsedLimit = parseInt(searchParams.get('limit') || '50', 10)
  const page = Math.max(1, Number.isFinite(parsedPage) ? parsedPage : 1)
  const limit = Math.min(
    100,
    Math.max(1, Number.isFinite(parsedLimit) ? parsedLimit : 50)
  )

  const [rows, currentVersionRaw] = await Promise.all([
    listAgentVersions(id, { limit, offset: (page - 1) * limit }),
    getAgentCurrentVersion(id)
  ])
  const currentVersion = currentVersionRaw ?? 0

  // Resolve createdBy ids → display names in one query.
  const authorIds = Array.from(
    new Set(rows.map(r => r.createdBy).filter((v): v is string => Boolean(v)))
  )
  const nameById: Record<string, string> = {}
  if (authorIds.length) {
    const authors = await getMigrateDb()
      .select({ id: usersTable.id, name: usersTable.name })
      .from(usersTable)
      .where(inArray(usersTable.id, authorIds))
    for (const a of authors) if (a.name) nameById[a.id] = a.name
  }

  return NextResponse.json({
    versions: rows.map(r => ({
      versionNo: r.versionNo,
      source: r.source,
      changeNote: r.changeNote,
      restoredFrom: r.restoredFrom,
      createdBy: r.createdBy,
      createdByName: r.createdBy ? (nameById[r.createdBy] ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      isCurrent: r.versionNo === currentVersion
    })),
    currentVersion
  })
}
