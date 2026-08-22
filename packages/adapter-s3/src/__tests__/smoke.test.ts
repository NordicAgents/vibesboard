// Set S3/MinIO env defaults before importing the adapter (it reads env lazily).
import './test-env.ts'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ensureBucket } from '@vibesboard/test-helpers/s3'
import {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  downloadFile,
  deleteFile,
  fileExists,
} from '../index.ts'

// Tests require MinIO running (bun run db:up); env: S3_ENDPOINT, S3_BUCKET,
// S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE.

describe('adapter-s3 smoke', () => {
  const createdKeys: string[] = []

  beforeAll(async () => {
    await ensureBucket()
  })

  afterEach(async () => {
    // Best-effort cleanup of any keys the test created.
    for (const key of createdKeys.splice(0)) {
      await deleteFile(key).catch(() => {})
    }
  })

  it('upload → exists → download (signed + raw) → delete → not-exists round-trip', async () => {
    const key = `test-${randomUUID()}/hello.txt`
    createdKeys.push(key)
    const body = 'hello, vibesboard'

    // 1. Signed PUT
    const uploadUrl = await getSignedUploadUrl(key, 'text/plain')
    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'text/plain' },
    })
    expect(putResp.status, `PUT failed: ${putResp.status} ${await putResp.text()}`).toBe(200)

    // 2. fileExists is true
    expect(await fileExists(key)).toBe(true)

    // 3. Signed GET returns the body
    const downloadUrl = await getSignedDownloadUrl(key)
    const getResp = await fetch(downloadUrl)
    expect(getResp.status).toBe(200)
    expect(await getResp.text()).toBe(body)

    // 4. downloadFile returns the same body as a Buffer
    const buf = await downloadFile(key)
    expect(buf.toString('utf8')).toBe(body)

    // 5. delete + fileExists false
    await deleteFile(key)
    expect(await fileExists(key)).toBe(false)

    // 6. delete is idempotent — no throw on missing key
    await deleteFile(key)
  })

  it('signed upload URL carries no checksum params (GCS/R2 compatibility)', async () => {
    // AWS SDK v3 >= 3.729 otherwise injects x-amz-checksum-crc32 with an
    // empty-body checksum, which breaks non-empty presigned PUTs to GCS/R2.
    const url = await getSignedUploadUrl(`test-${randomUUID()}/x.txt`, 'text/plain')
    const q = new URL(url).searchParams
    expect(q.get('x-amz-checksum-crc32')).toBeNull()
    expect(q.get('x-amz-sdk-checksum-algorithm')).toBeNull()
    // sanity: it is still a signed URL
    expect(q.get('X-Amz-Signature')).toBeTruthy()
  })
})
