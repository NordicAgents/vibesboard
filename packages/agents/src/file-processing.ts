import { adminDb } from '@vibesboard/adapter-firebase/admin'
import { Collections } from '@vibesboard/contracts'
import { processFile } from '@vibesboard/ai/file-processor'

/**
 * Guess MIME type from file extension
 */
export function guessMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split('.').pop()
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    htm: 'text/html',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp'
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}

/**
 * Create agent_files entries and trigger background processing
 * This enables auto-processing of uploaded files for RAG
 */
export async function createAgentFilesAndTriggerProcessing(params: {
  agentId: string
  tenantId: string
  userId: string
  fileKeys: string[]
}) {
  const { agentId, tenantId, userId, fileKeys } = params

  try {
    const batch = adminDb.batch()
    const collPath = Collections.agentFiles(tenantId, agentId)
    const createdFiles: Array<{
      id: string
      agentId: string
      fileKey: string
      fileName: string
      mimeType: string
    }> = []

    for (const fileKey of fileKeys) {
      try {
        const fileName = fileKey.split('/').pop() || fileKey
        const mimeType = guessMimeType(fileName)

        const ref = adminDb.collection(collPath).doc()
        const now = new Date().toISOString()

        batch.set(ref, {
          id: ref.id,
          agentId,
          tenantId,
          userId,
          fileKey,
          fileName,
          fileSize: 0,
          mimeType,
          status: 'pending',
          createdAt: now,
          updatedAt: now
        })

        createdFiles.push({
          id: ref.id,
          agentId,
          fileKey,
          fileName,
          mimeType
        })
      } catch (error) {
        console.error(`Failed to prepare file entry for ${fileKey}:`, error)
      }
    }

    if (createdFiles.length === 0) {
      return
    }

    await batch.commit()

    // Trigger background processing for each file (non-blocking)
    Promise.all(
      createdFiles.map(file =>
        processFile({
          fileId: file.id,
          agentId: file.agentId,
          tenantId,
          fileKey: file.fileKey,
          fileName: file.fileName,
          mimeType: file.mimeType || 'application/octet-stream'
        })
      )
    ).catch(error => {
      console.error('[Agent Creation] Background file processing error:', error)
    })

    console.log(
      `[Agent Creation] Triggered processing for ${createdFiles.length} files`
    )
  } catch (error) {
    console.error('[Agent Creation] Error in file processing setup:', error)
  }
}
