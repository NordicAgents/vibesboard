import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { getAgentVersion } from '@vibesboard/agents/versioning'

export const runtime = 'nodejs'

/**
 * GET /api/agents/[id]/versions/[versionNo]
 * Full config snapshot for a single version.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionNo: string }> }
) {
  const { id, versionNo: versionNoRaw } = await params
  const versionNo = Number.parseInt(versionNoRaw, 10)
  if (!Number.isInteger(versionNo) || versionNo < 1) {
    return NextResponse.json(
      { error: 'Invalid version number' },
      { status: 400 }
    )
  }

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

  const version = await getAgentVersion(id, versionNo)
  if (!version) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.json({
    version: {
      versionNo: version.versionNo,
      source: version.source,
      changeNote: version.changeNote,
      restoredFrom: version.restoredFrom,
      createdBy: version.createdBy,
      createdAt: version.createdAt.toISOString(),
      // config snapshot excludes accessPasswordHash by construction (§3.1)
      config: version.config
    }
  })
}
