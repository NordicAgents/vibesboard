export const MAX_FILE_UPLOAD_BYTES = 10 * 1024 * 1024

export const ACCEPTED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
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
