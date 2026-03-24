import { Buffer } from 'node:buffer'

import { Configuration, OpenAIApi } from 'openai-edge'
import { FieldValue } from 'firebase-admin/firestore'

import { adminDb } from '@/lib/firebase/admin'
import { downloadFile } from '@/lib/firebase/storage'
import { Collections } from '@/lib/firestore-types'
import { OPENAI_VISION_MODEL, isResponsesModel } from '@/lib/openai'

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small'
const VISION_MODEL = OPENAI_VISION_MODEL

const openai = new OpenAIApi(
  new Configuration({
    apiKey: process.env.OPENAI_API_KEY
  })
)

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/svg+xml'
])

const htmlTagRegex = /<[^>]+>/g

const cleanText = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const guessMimeFromPath = (path: string) => {
  const lower = path.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (lower.endsWith('.doc')) return 'application/msword'
  if (lower.endsWith('.xlsx'))
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel'
  if (lower.endsWith('.pptx'))
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint'
  if (lower.endsWith('.csv')) return 'text/csv'
  if (lower.endsWith('.md')) return 'text/markdown'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html'
  if (lower.endsWith('.txt')) return 'text/plain'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.tiff') || lower.endsWith('.tif')) return 'image/tiff'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

const decodeText = (buffer: Buffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  } catch {
    return ''
  }
}

const extractFromHtml = (raw: string) =>
  cleanText(raw.replace(htmlTagRegex, ' '))

const extractFromWorkbook = async (buffer: Buffer) => {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []

  workbook.SheetNames.forEach(sheetName => {
    const worksheet = workbook.Sheets[sheetName]
    const csv = XLSX.utils.sheet_to_csv(worksheet)
    if (csv?.trim()) {
      parts.push(`# Sheet: ${sheetName}\n${csv}`)
    }
  })

  return cleanText(parts.join('\n\n'))
}

const extractFromDoc = async (buffer: Buffer) => {
  const mammothModule = await import('mammoth')
  const mammoth: any = (mammothModule as any).default ?? mammothModule
  const result = await mammoth.extractRawText({ buffer })
  return cleanText(result.value || '')
}

let pdfWorkerConfigured = false
let pdfWorkerGetPath: (() => string) | undefined
let pdfWorkerGetData: (() => string) | undefined
let pdfCanvasFactory: any

const ensurePdfWorker = async (PDFParseClass: any) => {
  if (pdfWorkerConfigured) return

  try {
    const workerModule: any = await import('pdf-parse/worker').catch(() => null)

    if (workerModule) {
      pdfWorkerGetPath =
        typeof workerModule.getPath === 'function' ? workerModule.getPath : undefined
      pdfWorkerGetData =
        typeof workerModule.getData === 'function' ? workerModule.getData : undefined
      pdfCanvasFactory = workerModule.CanvasFactory ?? undefined
    }

    if (typeof PDFParseClass?.setWorker === 'function') {
      const workerSource =
        (pdfWorkerGetPath && pdfWorkerGetPath()) ||
        (pdfWorkerGetData && pdfWorkerGetData()) ||
        undefined

      if (workerSource) {
        PDFParseClass.setWorker(workerSource)
      }
    }

    pdfWorkerConfigured = true
  } catch {
    // Ignore worker configuration errors
  }
}

const extractFromPdf = async (buffer: Buffer) => {
  const pdfModule = await import('pdf-parse')

  const PDFParseClass: any = (pdfModule as any).PDFParse
  if (typeof PDFParseClass === 'function') {
    await ensurePdfWorker(PDFParseClass)

    const parser = new PDFParseClass({
      data: buffer,
      ...(pdfCanvasFactory ? { CanvasFactory: pdfCanvasFactory } : {})
    })
    try {
      const result = await parser.getText?.()
      return cleanText(result?.text || '')
    } finally {
      if (typeof parser.destroy === 'function') {
        await parser.destroy().catch(() => {})
      }
    }
  }

  const legacyParser: any =
    typeof (pdfModule as any).default === 'function'
      ? (pdfModule as any).default
      : typeof pdfModule === 'function'
        ? pdfModule
        : null

  if (legacyParser) {
    const data = await legacyParser(buffer)
    return cleanText(data?.text || '')
  }

  throw new Error('Unsupported pdf-parse import shape')
}

const extractTextFromImage = async (buffer: Buffer, mimeType: string) => {
  const base64 = buffer.toString('base64')
  const dataUrl = `data:${mimeType};base64,${base64}`
  const prompt = 'Extract all visible text from this image and provide a short description. Return plain text only.'

  if (isResponsesModel(VISION_MODEL)) {
    // Use the Responses API for gpt-5.4-nano and similar models
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) return ''

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: dataUrl }
            ]
          }
        ]
      })
    })

    if (!res.ok) {
      const errorText = await res.text().catch(() => '')
      console.error('[extractTextFromImage] Responses API error', res.status, errorText)
      return ''
    }

    const json = await res.json()
    // Parse Responses API output format
    const output = json?.output
    if (Array.isArray(output)) {
      for (const item of output) {
        if (item?.type !== 'message' || !Array.isArray(item.content)) continue
        const parts: string[] = []
        for (const part of item.content) {
          if (part?.type === 'output_text' && typeof part.text === 'string') {
            parts.push(part.text)
          }
        }
        if (parts.length) return cleanText(parts.join(''))
      }
    }
    return ''
  }

  // Fallback: Chat Completions API for older vision models
  const response = await openai.createChatCompletion({
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  })

  const json = await response.json()
  const rawContent = json?.choices?.[0]?.message?.content
  const content =
    Array.isArray(rawContent) && rawContent.length
      ? rawContent
          .map((entry: any) => (typeof entry?.text === 'string' ? entry.text : ''))
          .join('\n')
      : rawContent || ''

  return cleanText(String(content))
}

const extractTextFromBuffer = async (
  buffer: Buffer,
  mimeType: string
): Promise<string> => {
  if (IMAGE_MIME_TYPES.has(mimeType)) {
    return extractTextFromImage(buffer, mimeType)
  }

  if (mimeType.startsWith('text/')) {
    return cleanText(decodeText(buffer))
  }

  if (mimeType === 'application/json' || mimeType === 'application/xml') {
    return cleanText(decodeText(buffer))
  }

  if (mimeType === 'text/html') {
    return extractFromHtml(decodeText(buffer))
  }

  if (mimeType === 'text/markdown') {
    return cleanText(decodeText(buffer))
  }

  if (mimeType === 'text/csv') {
    return cleanText(decodeText(buffer))
  }

  if (mimeType === 'application/pdf') {
    return extractFromPdf(buffer)
  }

  if (
    mimeType === 'application/msword' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractFromDoc(buffer)
  }

  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType ===
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return extractFromWorkbook(buffer)
  }

  return cleanText(decodeText(buffer))
}

const chunkText = (input: string, targetLength = 1200, overlap = 200) => {
  const chunks: string[] = []
  let cursor = 0
  const normalized = cleanText(input)

  while (cursor < normalized.length) {
    const end = Math.min(normalized.length, cursor + targetLength)
    const slice = normalized.slice(cursor, end)
    chunks.push(slice)
    cursor += targetLength - overlap
  }

  return chunks
}

const embedChunks = async (values: string[]) => {
  if (!values.length) {
    return []
  }
  const response = await openai.createEmbedding({
    model: EMBEDDING_MODEL,
    input: values
  })
  const json = await response.json()
  return (json?.data ?? []).map((entry: any) => entry?.embedding ?? [])
}

/**
 * Delete existing file chunks for a given agent + file key.
 * Requires tenantId to resolve the subcollection path.
 */
const BATCH_LIMIT = 400

const deleteExistingChunks = async (
  tenantId: string,
  agentId: string,
  fileKey: string
) => {
  const collPath = Collections.fileChunks(tenantId, agentId)
  const snapshot = await adminDb
    .collection(collPath)
    .where('fileKey', '==', fileKey)
    .get()

  if (snapshot.empty) return

  for (let i = 0; i < snapshot.docs.length; i += BATCH_LIMIT) {
    const batch = adminDb.batch()
    snapshot.docs.slice(i, i + BATCH_LIMIT).forEach(doc => batch.delete(doc.ref))
    await batch.commit()
  }
}

export const ingestFileForAgent = async (args: {
  tenantId: string
  agentId: string
  fileKey: string
  fileName?: string
  mimeType?: string | null
}) => {
  const { tenantId, agentId, fileKey } = args
  const fileName = args.fileName || fileKey.split('/').pop() || fileKey
  const mimeType = args.mimeType || guessMimeFromPath(fileName)

  // Download from GCS
  const buffer = await downloadFile(fileKey)

  const text = await extractTextFromBuffer(buffer, mimeType)

  if (!text.trim()) {
    return {
      chunksInserted: 0,
      message: 'File has no extractable text content.'
    }
  }

  const chunks = chunkText(text)
  const embeddings = await embedChunks(chunks)

  if (!embeddings.length) {
    return {
      chunksInserted: 0,
      message: 'No embeddings generated for file.'
    }
  }

  await deleteExistingChunks(tenantId, agentId, fileKey)

  // Write chunks to Firestore with vector embeddings
  // Firestore batch writes are limited to 500 operations — split into batches of 400
  const collPath = Collections.fileChunks(tenantId, agentId)

  for (let i = 0; i < chunks.length; i += BATCH_LIMIT) {
    const batch = adminDb.batch()
    const slice = chunks.slice(i, i + BATCH_LIMIT)

    slice.forEach((content, sliceIndex) => {
      const index = i + sliceIndex
      const ref = adminDb.collection(collPath).doc()
      batch.set(ref, {
        id: ref.id,
        agentId,
        fileKey,
        fileName,
        mimeType,
        chunkIndex: index,
        content,
        embedding: FieldValue.vector(embeddings[index] ?? []),
        createdAt: new Date().toISOString()
      })
    })

    await batch.commit()
  }

  const totalChars = chunks.reduce((sum, c) => sum + c.length, 0)

  return {
    chunksInserted: chunks.length,
    totalChars,
    message: `Ingested ${chunks.length} chunk(s) for search.`
  }
}

/**
 * Search agent file chunks — delegates to rag-retriever for a single search path.
 */
export const searchAgentFileChunks = async (args: {
  tenantId: string
  agentId: string
  query: string
  limit?: number
}) => {
  const { tenantId, agentId, query, limit = 8 } = args

  try {
    const { retrieveContext } = await import('@/lib/agent/rag-retriever')
    const ragContext = await retrieveContext(tenantId, agentId, query, {
      topK: limit,
      enableFallback: true
    })

    const matches = ragContext.chunks.map(chunk => ({
      fileName: chunk.fileName,
      fileKey: chunk.fileKey,
      snippet: chunk.content,
      score: chunk.similarity
    }))

    return { matches }
  } catch (err: any) {
    console.error('[file-search] Search failed:', err?.message)
    return { matches: [], error: err?.message ?? 'Search failed.' }
  }
}
