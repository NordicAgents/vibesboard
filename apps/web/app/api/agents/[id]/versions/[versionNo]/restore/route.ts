import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth/route-handler'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { restoreAgentVersion } from '@vibesboard/agents/versioning'
import { createAgentFilesAndTriggerProcessing } from '@vibesboard/agents/file-processing'
import { getFilesByKeys } from '@vibesboard/ai/files-store'
import { fileExists, isPermittedAgentFileKey } from '@vibesboard/adapter-s3'

export const runtime = 'nodejs'

/**
 * POST /api/agents/[id]/versions/[versionNo]/restore
 * Restore the agent to a prior version. Forward-only (appends a new version).
 * Re-triggers file embedding for any files the restore re-adds that still exist
 * in storage, and reports any whose underlying object is gone.
 */
export async function POST(
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
  const { user } = authResult

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

  let restore
  try {
    restore = await restoreAgentVersion(id, versionNo, { actor: user.id })
  } catch (error) {
    // version not found → 404, anything else → 500
    const message = error instanceof Error ? error.message : 'Restore failed'
    const status = message.includes('not found') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }

  // Reconcile file embeddings for keys the restore re-added. Drop any key not
  // bound to this exact agent so an old snapshot cannot reintroduce a poisoned
  // reference to another agent's storage object.
  const reAdded = restore.snapshot.fileKeys.filter(
    key =>
      !restore.previousFileKeys.includes(key) &&
      isPermittedAgentFileKey(
        key,
        agent.tenantId,
        agent.id,
        agent.userId
      )
  )
  const missingFiles: string[] = []
  if (reAdded.length > 0) {
    // fileKeys that already have a file record (embeddings intact) need nothing.
    // Queried by the specific re-added keys — bounded by reAdded.length, no
    // pagination limit to fall short of for agents with many existing files.
    const knownFiles = await getFilesByKeys(id, reAdded)
    const known = new Set(knownFiles.map(f => f.fileKey))

    const keysToCheck = reAdded.filter(key => !known.has(key))
    const existsResults = await Promise.all(
      keysToCheck.map(key => fileExists(key))
    )
    const toProcess: string[] = []
    keysToCheck.forEach((key, i) => {
      if (existsResults[i]) {
        toProcess.push(key)
      } else {
        missingFiles.push(key)
      }
    })

    if (toProcess.length > 0) {
      await createAgentFilesAndTriggerProcessing({
        agentId: id,
        tenantId: agent.tenantId,
        userId: user.id,
        fileKeys: toProcess
      })
    }
  }

  const updated = await getAgentById(id)
  return NextResponse.json({
    agent: updated,
    restoredFrom: versionNo,
    versionNo: restore.versionNo,
    warnings: missingFiles.length
      ? [
          `${missingFiles.length} file(s) referenced by this version are no longer in storage and were skipped: ${missingFiles.join(', ')}`
        ]
      : []
  })
}
