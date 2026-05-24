import { insertFiles } from '@vibesboard/ai/files-store'
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
    const inputs = fileKeys.map(fileKey => {
      const fileName = fileKey.split('/').pop() || fileKey
      return {
        tenantId,
        agentId,
        userId,
        fileKey,
        fileName,
        mimeType: guessMimeType(fileName),
        fileSize: 0
      }
    })

    if (inputs.length === 0) {
      return
    }

    const created = await insertFiles(inputs)

    // Trigger background processing for each file (non-blocking)
    Promise.all(
      created.map(f =>
        processFile({
          fileId: f.id,
          agentId,
          tenantId,
          fileKey: f.fileKey,
          fileName: f.fileName,
          mimeType: f.mimeType
        })
      )
    ).catch(error => {
      console.error('[Agent Creation] Background file processing error:', error)
    })

    console.log(
      `[Agent Creation] Triggered processing for ${created.length} files`
    )
  } catch (error) {
    console.error('[Agent Creation] Error in file processing setup:', error)
  }
}
