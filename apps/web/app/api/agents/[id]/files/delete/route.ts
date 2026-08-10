import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { auth } from '@/auth'
import { deleteFile } from '@vibesboard/adapter-s3'
import { getAgentById } from '@vibesboard/agents/server'
import { canEditAgent } from '@vibesboard/agents/permissions'
import { recordAgentVersion } from '@vibesboard/agents/versioning'
import { getFilesByKeys } from '@vibesboard/ai/files-store'
import { deleteFileEmbeddings } from '@vibesboard/ai/rag-store'
import { getMigrateDb, type Db } from '@vibesboard/adapter-postgres/client'
import { agents, files } from '@vibesboard/adapter-postgres/schema'

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

  // The key must actually belong to this agent.
  if (!(agent.fileKeys ?? []).includes(fileKey)) {
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
    const fileRows = await getFilesByKeys(id, [fileKey])
    for (const file of fileRows) {
      // Embeddings reference the file by sourceId with no foreign key, so
      // deleting the row cascades nothing — the chunks must go explicitly, and
      // first: a file row without chunks is inert, orphaned chunks are not.
      await deleteFileEmbeddings(agent.tenantId, file.id)
    }

    await getMigrateDb().transaction(async tx => {
      // Lock the agent row before touching either table so this serializes
      // with the upload path (POST /api/agents/[id]/files) instead of racing
      // it on a stale fileKeys read.
      const [row] = await tx
        .select({ fileKeys: agents.fileKeys })
        .from(agents)
        .where(eq(agents.id, id))
        .for('update')

      await tx
        .delete(files)
        .where(and(eq(files.agentId, id), eq(files.fileKey, fileKey)))

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

    await deleteFile(fileKey)
    return NextResponse.json({ status: 'ok' })
  } catch (error: any) {
    // Log the key: a failure in the storage step leaves the object behind once
    // the rows are already committed, and the log is the only trace of it.
    console.error(`[File Delete] agent=${id} key=${fileKey}`, error)
    return NextResponse.json(
      { error: error?.message ?? 'Failed to delete file' },
      { status: 500 }
    )
  }
}
