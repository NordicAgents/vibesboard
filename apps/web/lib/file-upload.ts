export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024

// Keep browser file pickers in sync with the formats accepted below. These are
// extensions rather than MIME types because the HTML `accept` attribute is a
// picker hint; the server remains the enforcement point.
export const ACCEPTED_UPLOAD_FILE_TYPES =
  '.pdf,.txt,.md,.json,.csv,.docx,.xlsx,.png,.jpg,.jpeg,.gif,.webp,.tiff,.svg,.html,.xml'

// Only formats packages/ai/src/file-search.ts can actually extract text from.
// PowerPoint (.ppt/.pptx) and the legacy binary Word/Excel formats (.doc/.xls)
// were accepted here but have no working extractor behind them, so they were
// uploaded, then either indexed as decoded binary noise or failed with an
// error about a missing ZIP directory. Rejecting them at the picker gives the
// uploader an answer immediately instead of after a round trip.
export const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/tiff',
  'image/svg+xml',
  'application/octet-stream'
])

export function isAcceptedUploadMimeType(value: unknown): value is string {
  return typeof value === 'string' && ACCEPTED_UPLOAD_MIME_TYPES.has(value)
}

export function isValidUploadSize(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_FILE_UPLOAD_BYTES
  )
}
