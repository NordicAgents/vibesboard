export const MAX_INGESTED_FILE_BYTES = 10 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 1_000
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
export const MAX_ARCHIVE_COMPRESSION_RATIO = 100
export const MAX_PDF_PAGES = 200
export const MAX_WORKBOOK_ROWS = 25_000
export const MAX_WORKBOOK_CELLS = 250_000
export const MAX_EXTRACTED_TEXT_CHARS = 500_000
export const MAX_FILE_CHUNKS = 500

export class FileProcessingLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FileProcessingLimitError'
  }
}

export function assertIngestedFileSize(buffer: Buffer): void {
  if (buffer.byteLength > MAX_INGESTED_FILE_BYTES) {
    throw new FileProcessingLimitError(
      `File exceeds the ${MAX_INGESTED_FILE_BYTES}-byte ingestion limit.`
    )
  }
}

export function assertArchiveMetadataWithinLimits(args: {
  archiveBytes: number
  entryCount: number
  uncompressedBytes: number
}): void {
  if (args.entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new FileProcessingLimitError(
      `Archive has too many entries (maximum ${MAX_ARCHIVE_ENTRIES}).`
    )
  }
  if (args.uncompressedBytes > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new FileProcessingLimitError(
      `Archive expands beyond the ${MAX_ARCHIVE_UNCOMPRESSED_BYTES}-byte limit.`
    )
  }
  const ratio = args.uncompressedBytes / Math.max(1, args.archiveBytes)
  if (ratio > MAX_ARCHIVE_COMPRESSION_RATIO) {
    throw new FileProcessingLimitError(
      `Archive compression ratio exceeds the ${MAX_ARCHIVE_COMPRESSION_RATIO}:1 limit.`
    )
  }
}

export async function assertZipArchiveWithinLimits(
  buffer: Buffer
): Promise<void> {
  const jsZipModule = await import('jszip')
  const JSZip = jsZipModule.default ?? jsZipModule
  const archive = await JSZip.loadAsync(buffer, { checkCRC32: false })
  const entries = Object.values(archive.files).filter(entry => !entry.dir)
  let uncompressedBytes = 0

  for (const entry of entries) {
    const declaredSize = Number(
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data
        ?.uncompressedSize
    )
    if (!Number.isSafeInteger(declaredSize) || declaredSize < 0) {
      throw new FileProcessingLimitError(
        'Archive entry size metadata is missing or invalid.'
      )
    }
    uncompressedBytes += declaredSize
    if (!Number.isSafeInteger(uncompressedBytes)) {
      throw new FileProcessingLimitError('Archive size metadata overflowed.')
    }
  }

  assertArchiveMetadataWithinLimits({
    archiveBytes: buffer.byteLength,
    entryCount: entries.length,
    uncompressedBytes
  })
}

export function assertExtractedTextWithinLimits(text: string): void {
  if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
    throw new FileProcessingLimitError(
      `Extracted text exceeds the ${MAX_EXTRACTED_TEXT_CHARS}-character limit.`
    )
  }
}

export function assertChunkCountWithinLimits(count: number): void {
  if (count > MAX_FILE_CHUNKS) {
    throw new FileProcessingLimitError(
      `File would create too many search chunks (maximum ${MAX_FILE_CHUNKS}).`
    )
  }
}
