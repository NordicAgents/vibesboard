import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  getSignedUploadUrl,
  getSignedDownloadUrl,
  downloadFile,
  deleteFile,
  fileExists,
} from '../index.ts'

// Tests require MinIO running (bun run db:up); env: S3_ENDPOINT, S3_BUCKET,
// S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE.

// Set sensible local defaults if env isn't loaded (e.g. from a .env file).
process.env.S3_ENDPOINT          ??= 'http://localhost:9000'
process.env.S3_REGION            ??= 'us-east-1'
process.env.S3_BUCKET            ??= 'vibesboard-files'
process.env.S3_ACCESS_KEY_ID     ??= 'vibesboard'
process.env.S3_SECRET_ACCESS_KEY ??= 'vibesboard'
process.env.S3_FORCE_PATH_STYLE  ??= 'true'

describe('adapter-s3 smoke', () => {
  test('upload → exists → download (signed + raw) → delete → not-exists round-trip', async () => {
    const key = `test-${randomUUID()}/hello.txt`
    const body = 'hello, vibesboard'

    // 1. Signed PUT
    const uploadUrl = await getSignedUploadUrl(key, 'text/plain')
    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'text/plain' },
    })
    assert.equal(putResp.status, 200, `PUT failed: ${putResp.status} ${await putResp.text()}`)

    // 2. fileExists is true
    assert.equal(await fileExists(key), true)

    // 3. Signed GET returns the body
    const downloadUrl = await getSignedDownloadUrl(key)
    const getResp = await fetch(downloadUrl)
    assert.equal(getResp.status, 200)
    assert.equal(await getResp.text(), body)

    // 4. downloadFile returns the same body as a Buffer
    const buf = await downloadFile(key)
    assert.equal(buf.toString('utf8'), body)

    // 5. delete + fileExists false
    await deleteFile(key)
    assert.equal(await fileExists(key), false)

    // 6. delete is idempotent — no throw on missing key
    await deleteFile(key)
  })

  test('signed upload URL carries no checksum params (GCS/R2 compatibility)', async () => {
    // AWS SDK v3 >= 3.729 otherwise injects x-amz-checksum-crc32 with an
    // empty-body checksum, which breaks non-empty presigned PUTs to GCS/R2.
    const url = await getSignedUploadUrl(`test-${randomUUID()}/x.txt`, 'text/plain')
    const q = new URL(url).searchParams
    assert.equal(q.get('x-amz-checksum-crc32'), null)
    assert.equal(q.get('x-amz-sdk-checksum-algorithm'), null)
    // sanity: it is still a signed URL
    assert.ok(q.get('X-Amz-Signature'))
  })
})
