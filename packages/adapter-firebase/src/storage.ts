import 'server-only'
import { adminStorage } from './admin'

const bucket = adminStorage.bucket()

/**
 * Generate a signed URL for uploading a file directly from the browser.
 */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInMs = 15 * 60 * 1000
): Promise<string> {
  const [url] = await bucket.file(key).getSignedUrl({
    version: 'v4',
    action: 'write',
    expires: Date.now() + expiresInMs,
    contentType
  })
  return url
}

/**
 * Generate a signed URL for downloading / reading a file.
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresInMs = 60 * 60 * 1000
): Promise<string> {
  const [url] = await bucket.file(key).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiresInMs
  })
  return url
}

/**
 * Download a file's contents as a Buffer (for server-side processing).
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const [contents] = await bucket.file(key).download()
  return contents
}

/**
 * Delete a file from the bucket.
 */
export async function deleteFile(key: string): Promise<void> {
  await bucket.file(key).delete({ ignoreNotFound: true })
}

/**
 * Check if a file exists.
 */
export async function fileExists(key: string): Promise<boolean> {
  const [exists] = await bucket.file(key).exists()
  return exists
}

export { bucket }
