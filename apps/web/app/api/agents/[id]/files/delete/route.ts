import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { deleteFile, isCrossTenantFileKey } from '@vibesboard/adapter-s3'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { recordAgentVersion } from '@vibesboard/agents/versioning'
import { deleteFilesByKey, getFilesByKeys } from '@vibesboard/ai/files-store'
import { deleteFileEmbeddings } from '@vibesboard/ai/rag-store'
import { getMigrateDb, type Db } from '@vibesboard/adapter-postgres/client'
import { agents } from '@vibesboard/adapter-postgres/schema'

export const runtime = 'nodejs'

/**
 * POST /api/agents/[id]/files/delete
 * Deletes a file attached to this agent: its RAG chunks, its `files` row, its
 * key on the agent, and the stored object.
 *
 * The fileKey is caller-supplied, so it must be authorized against the agent
 * in the path — previously this route deleted ANY key in the bucket for any
 * authenticated user, which allowed destroying every tenant's uploads.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return new NextResponse('Unauthorized', { status: 401 })
  }
  // Hoisted out of the session object: property narrowing doesn't survive into
  // the transaction callback below.
  const userId = session.user.id

  const { fileKey } = await req.json()
  if (!fileKey) {
    return NextResponse.json({ error: 'fileKey is required' }, { status: 400 })
  }

  const agent = await getAgentById(id)
  if (!agent) {
    return new NextResponse('Not found', { status: 404 })
  }

  const canEdit = await canEditAgent({
    sessionUserId: session.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId
  })
  if (!canEdit) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  // The key must actually belong to this agent...
  if (!(agent.fileKeys ?? []).includes(fileKey)) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  // ...and the array is caller-writable, so refuse a poisoned key that would
  // delete another tenant's stored object.
  if (isCrossTenantFileKey(fileKey, agent.tenantId)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  try {
    // Order matters: everything the agent can still *retrieve* goes before the
    // stored object. This route used to delete only the S3 object, so the
    // `files` row and its embeddings survived — and retrieval joins those
    // chunks in by files.agentId alone (rag-store.ts vectorSearchFileChunks /
    // keywordSearchFileChunks, no status or existence filter), so the agent
    // kept quoting documents the user had deleted, indefinitely.
    //
    // All rows for the key, not just the first: nothing enforces one `files`
    // row per (agentId, fileKey), so a re-uploaded key can have several and
    // leaving any of them behind leaves its chunks retrievable.
    await getMigrateDb().transaction(async tx => {
      // Lock the agent row before touching either table so this serializes
      // with the upload path (POST /api/agents/[id]/files) instead of racing
      // it on a stale fileKeys read.
      const [row] = await tx
        .select({ fileKeys: agents.fileKeys })
        .from(agents)
        .where(eq(agents.id, id))
        .for('update')

      const fileRows = await getFilesByKeys(id, [fileKey], tx as unknown as Db)
      for (const file of fileRows) {
        // Embeddings reference the file by sourceId with no foreign key, so
        // deleting the row cascades nothing — the chunks must go explicitly.
        await deleteFileEmbeddings(agent.tenantId, file.id, tx as unknown as Db)
      }

      await deleteFilesByKey(id, fileKey, tx as unknown as Db)

      // fileKeys is stripped here rather than left to the client's follow-up
      // PATCH: that PATCH can fail (or never run) after the object is already
      // gone, stranding a key that points at nothing.
      const remainingFileKeys = (row?.fileKeys ?? []).filter(
        key => key !== fileKey
      )
      await tx
        .update(agents)
        .set({ fileKeys: remainingFileKeys, updatedAt: new Date() })
        .where(eq(agents.id, id))

      // Keeps the removal in agent history the way the upload path records the
      // addition. No-ops internally when the config snapshot is unchanged.
      await recordAgentVersion(tx as unknown as Db, id, {
        source: 'file-sync',
        actor: userId,
        note: 'File deleted'
      })
    })
  } catch (error: any) {
    console.error(
      `[File Delete] database cleanup agent=${id} key=${fileKey}`,
      error
    )
    return NextResponse.json(
      { error: error?.message ?? 'Failed to delete file' },
      { status: 500 }
    )
  }

  // The database is authoritative for visibility and retrieval. A storage
  // outage after commit must not make the client retain a file that has already
  // been removed from the agent; log the orphan for a later cleanup retry.
  try {
    await deleteFile(fileKey)
    return NextResponse.json({ status: 'ok', storageDeleted: true })
  } catch (error) {
    console.error(
      `[File Delete] storage cleanup agent=${id} key=${fileKey}`,
      error
    )
    return NextResponse.json({ status: 'ok', storageDeleted: false })
  }
}
