import 'server-only'
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getS3Client, getBucket } from './client.ts'

export { agentFileKey } from './keys.ts'

/**
 * Generate a signed URL for uploading a file directly from the browser.
 * The client MUST send the same Content-Type header when issuing the PUT.
 */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInMs = 15 * 60 * 1000,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  })
  return getSignedUrl(getS3Client(), command, {
    expiresIn: Math.floor(expiresInMs / 1000),
  })
}

/**
 * Generate a signed URL for downloading a file.
 */
export async function getSignedDownloadUrl(
  key: string,
  expiresInMs = 60 * 60 * 1000,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  return getSignedUrl(getS3Client(), command, {
    expiresIn: Math.floor(expiresInMs / 1000),
  })
}

/**
 * Download a file's contents as a Buffer.
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({ Bucket: getBucket(), Key: key })
  const response = await getS3Client().send(command)
  if (!response.Body) {
    throw new Error(`[adapter-s3] Empty body for key: ${key}`)
  }
  // Body is a readable stream; convert to Buffer.
  const chunks: Buffer[] = []
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * Delete a file. Missing keys are silently ignored (matches the prior
 * GCS adapter's `ignoreNotFound: true` semantics).
 */
export async function deleteFile(key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: getBucket(), Key: key })
  try {
    await getS3Client().send(command)
  } catch (err: unknown) {
    // S3 DELETE is idempotent — most providers don't error on missing keys —
    // but be defensive against the few that do.
    const name = (err as { name?: string } | null)?.name
    if (name === 'NoSuchKey' || name === 'NotFound') return
    throw err
  }
}

/**
 * Check if a file exists.
 */
export async function fileExists(key: string): Promise<boolean> {
  const command = new HeadObjectCommand({ Bucket: getBucket(), Key: key })
  try {
    await getS3Client().send(command)
    return true
  } catch (err: unknown) {
    const name = (err as { name?: string } | null)?.name
    if (name === 'NoSuchKey' || name === 'NotFound') return false
    // Some S3-compat providers return a different error name with a 404
    // statusCode — check that too.
    const meta = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    if (meta?.httpStatusCode === 404) return false
    throw err
  }
}
