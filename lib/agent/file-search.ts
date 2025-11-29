import { Buffer } from 'node:buffer'

import { Configuration, OpenAIApi } from 'openai-edge'
import type { SupabaseClient } from '@supabase/supabase-js'

import { getServiceSupabaseClient } from '@/lib/supabase/service-client'
import { type Database } from '@/lib/db_types'
import { OPENAI_VISION_MODEL } from '@/lib/openai'

const EMBEDDING_MODEL =
  process.env.OPENAI_EMBEDDINGS_MODEL ?? 'text-embedding-3-small'
const VISION_MODEL = OPENAI_VISION_MODEL
const STORAGE_BUCKET = 'agent-files'

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
    // Load the Node/Next.js worker helpers recommended by pdf-parse
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
    // Ignore worker configuration errors; we'll still attempt parsing.
  }
}

const extractFromPdf = async (buffer: Buffer) => {
  const pdfModule = await import('pdf-parse')

  // Prefer the class-based API introduced in pdf-parse v2.x
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
        await parser.destroy().catch(() => {
          /* ignore */
        })
      }
    }
  }

  // Fallback for the legacy function export (pdf-parse v1.x)
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
  const response = await openai.createChatCompletion({
    model: VISION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Extract all visible text from this image and provide a short description. Return plain text only.'
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`
            }
          }
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

const deleteExistingChunks = async (
  supabase: SupabaseClient<Database>,
  agentId: string,
  fileKey: string
) => {
  await supabase
    .from('agent_file_chunks')
    .delete()
    .eq('agent_id', agentId)
    .eq('file_key', fileKey)
}

export const ingestFileForAgent = async (args: {
  agentId: string
  fileKey: string
  fileName?: string
  mimeType?: string | null
}) => {
  const { agentId, fileKey } = args
  const fileName = args.fileName || fileKey.split('/').pop() || fileKey
  const mimeType = args.mimeType || guessMimeFromPath(fileName)

  const supabase = getServiceSupabaseClient()
  const download = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(fileKey)

  if (download.error || !download.data) {
    throw new Error(
      download.error?.message || 'Unable to download file for ingestion'
    )
  }

  const arrayBuffer = await download.data.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

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

  await deleteExistingChunks(supabase, agentId, fileKey)

  const rows = chunks.map((content, index) => ({
    agent_id: agentId,
    file_key: fileKey,
    file_name: fileName,
    mime_type: mimeType,
    chunk_index: index,
    content,
    embedding: embeddings[index] ?? null
  }))

  const { error } = await supabase.from('agent_file_chunks').insert(rows)
  if (error) {
    throw new Error(error.message)
  }

  return {
    chunksInserted: rows.length,
    message: `Ingested ${rows.length} chunk(s) for search.`
  }
}

export const searchAgentFileChunks = async (args: {
  agentId: string
  query: string
  limit?: number
}) => {
  const { agentId, query, limit = 8 } = args
  const supabase = getServiceSupabaseClient()

  const embedResponse = await openai.createEmbedding({
    model: EMBEDDING_MODEL,
    input: query
  })
  const embedJson = await embedResponse.json()
  const queryEmbedding = embedJson?.data?.[0]?.embedding

  if (!queryEmbedding) {
    return { matches: [], error: 'Embedding generation failed.' }
  }

  const rpc = await supabase.rpc('match_agent_file_chunks', {
    agent_id: agentId,
    query_embedding: queryEmbedding,
    match_count: limit
  })

  let rpcErrorMessage: string | undefined
  if (rpc.error) {
    const message = rpc.error.message ?? ''
    rpcErrorMessage = message
    const missingFn =
      message.toLowerCase().includes('does not exist') ||
      message.toLowerCase().includes('undefined function')

    if (!missingFn) {
      return { matches: [], error: message }
    }
  }

  const matches =
    rpc.data?.map(entry => ({
      fileName: entry.file_name,
      fileKey: entry.file_key,
      snippet: entry.content,
      score: entry.similarity ?? 0
    })) ?? []

  if (matches.length > 0) {
    return { matches }
  }

  // Fallback to a basic text search if the RPC is unavailable.
  const textFallback = await supabase
    .from('agent_file_chunks')
    .select('file_key,file_name,content')
    .eq('agent_id', agentId)
    .ilike('content', `%${query}%`)
    .limit(limit)

  if (textFallback.error) {
    return { matches: [], error: textFallback.error.message }
  }

  return {
    matches:
      textFallback.data?.map(entry => ({
        fileName: entry.file_name,
        fileKey: entry.file_key,
        snippet: entry.content,
        score: 0
      })) ?? [],
    error: rpcErrorMessage
  }
}
