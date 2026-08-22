// Set S3/MinIO env defaults before importing the adapter (it reads env lazily).
import './test-env.ts'
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ensureBucket } from '@vibesboard/test-helpers/s3'
import {
  uploadFile,
  downloadFile,
  deleteFile,
  fileExists,
  getFileMetadata,
  getSignedUploadUrl,
  getSignedDownloadUrl,
  agentFileKey,
} from '../index.ts'

// Integration tests against MinIO (localhost:9000, bucket vibesboard-files).
// Every test uses a unique key and cleans up in afterEach.

const createdKeys: string[] = []
function uniqueKey(suffix = 'blob.bin'): string {
  const key = `adapter-s3-test/${randomUUID()}/${suffix}`
  createdKeys.push(key)
  return key
}

describe('adapter-s3 server-side storage (MinIO)', () => {
  beforeAll(async () => {
    await ensureBucket()
  })

  afterEach(async () => {
    for (const key of createdKeys.splice(0)) {
      await deleteFile(key).catch(() => {})
    }
  })

  describe('uploadFile + downloadFile', () => {
    it('round-trips a string body', async () => {
      const key = uniqueKey('hello.txt')
      await uploadFile(key, 'plain string body', 'text/plain')
      const buf = await downloadFile(key)
      expect(buf.toString('utf8')).toBe('plain string body')
    })

    it('round-trips a Buffer body byte-for-byte', async () => {
      const key = uniqueKey('bytes.bin')
      const payload = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x7f, 0x80])
      await uploadFile(key, payload, 'application/octet-stream')
      const buf = await downloadFile(key)
      expect(Buffer.compare(buf, payload)).toBe(0)
    })

    it('round-trips a Uint8Array body', async () => {
      const key = uniqueKey('u8.bin')
      const payload = new Uint8Array([10, 20, 30, 40])
      await uploadFile(key, payload, 'application/octet-stream')
      const buf = await downloadFile(key)
      expect(Buffer.compare(buf, Buffer.from(payload))).toBe(0)
    })

    it('round-trips an empty body and the object still exists', async () => {
      const key = uniqueKey('empty.txt')
      await uploadFile(key, '', 'text/plain')
      const buf = await downloadFile(key)
      expect(buf.length).toBe(0)
      expect(await fileExists(key)).toBe(true)
    })

    it('overwrites an existing object on re-upload', async () => {
      const key = uniqueKey('overwrite.txt')
      await uploadFile(key, 'first', 'text/plain')
      await uploadFile(key, 'second', 'text/plain')
      const buf = await downloadFile(key)
      expect(buf.toString('utf8')).toBe('second')
    })

    it('downloadFile throws for a missing key', async () => {
      const key = `adapter-s3-test/missing-${randomUUID()}.txt`
      await expect(downloadFile(key)).rejects.toThrow()
    })

    it('forwards cacheControl and the object stays downloadable', async () => {
      const key = uniqueKey('cached.txt')
      await uploadFile(key, 'cache me', 'text/plain', {
        cacheControl: 'public, max-age=3600',
      })
      expect(await fileExists(key)).toBe(true)
      const buf = await downloadFile(key)
      expect(buf.toString('utf8')).toBe('cache me')
    })
  })

  describe('fileExists', () => {
    it('returns true for an uploaded object', async () => {
      const key = uniqueKey('exists.txt')
      await uploadFile(key, 'x', 'text/plain')
      expect(await fileExists(key)).toBe(true)
    })

    it('returns false for a missing object (no throw)', async () => {
      const key = `adapter-s3-test/never-${randomUUID()}.txt`
      expect(await fileExists(key)).toBe(false)
    })

    it('reflects deletion', async () => {
      const key = uniqueKey('toggle.txt')
      await uploadFile(key, 'x', 'text/plain')
      expect(await fileExists(key)).toBe(true)
      await deleteFile(key)
      expect(await fileExists(key)).toBe(false)
    })
  })

  describe('getFileMetadata', () => {
    it('returns contentType and size for an existing object', async () => {
      const key = uniqueKey('meta.txt')
      const body = 'twelve bytes' // 12 bytes
      await uploadFile(key, body, 'text/markdown')
      const meta = await getFileMetadata(key)
      expect(meta).not.toBeNull()
      expect(meta?.contentType).toBe('text/markdown')
      expect(meta?.size).toBe(Buffer.byteLength(body))
    })

    it('reports the correct size for binary content', async () => {
      const key = uniqueKey('binmeta.bin')
      const payload = Buffer.alloc(2048, 7)
      await uploadFile(key, payload, 'application/octet-stream')
      const meta = await getFileMetadata(key)
      expect(meta?.size).toBe(2048)
      expect(meta?.contentType).toBe('application/octet-stream')
    })

    it('returns null for a missing object (no throw)', async () => {
      const key = `adapter-s3-test/nometa-${randomUUID()}.txt`
      expect(await getFileMetadata(key)).toBeNull()
    })
  })

  describe('deleteFile', () => {
    it('deletes an existing object', async () => {
      const key = uniqueKey('del.txt')
      await uploadFile(key, 'bye', 'text/plain')
      await deleteFile(key)
      expect(await fileExists(key)).toBe(false)
    })

    it('is idempotent — does not throw for a missing key', async () => {
      const key = `adapter-s3-test/already-gone-${randomUUID()}.txt`
      await expect(deleteFile(key)).resolves.toBeUndefined()
    })

    it('can be called twice on the same key without throwing', async () => {
      const key = uniqueKey('twice.txt')
      await uploadFile(key, 'x', 'text/plain')
      await deleteFile(key)
      await expect(deleteFile(key)).resolves.toBeUndefined()
    })
  })

  describe('signed URLs (presigner)', () => {
    it('binds the declared content length into the upload signature', async () => {
      const key = uniqueKey('signed-length.txt')
      const url = await getSignedUploadUrl(
        key,
        'text/plain',
        15 * 60 * 1000,
        123
      )
      const signedHeaders =
        new URL(url).searchParams.get('X-Amz-SignedHeaders') ?? ''
      expect(signedHeaders.split(';')).toContain('content-length')
    })

    it('getSignedUploadUrl produces a working PUT URL', async () => {
      const key = uniqueKey('signed-put.txt')
      const url = await getSignedUploadUrl(key, 'text/plain')
      const resp = await fetch(url, {
        method: 'PUT',
        body: 'via signed put',
        headers: { 'Content-Type': 'text/plain' },
      })
      expect(resp.status).toBe(200)
      const buf = await downloadFile(key)
      expect(buf.toString('utf8')).toBe('via signed put')
    })

    it('getSignedDownloadUrl produces a working GET URL', async () => {
      const key = uniqueKey('signed-get.txt')
      await uploadFile(key, 'fetch me', 'text/plain')
      const url = await getSignedDownloadUrl(key)
      const resp = await fetch(url)
      expect(resp.status).toBe(200)
      expect(await resp.text()).toBe('fetch me')
    })

    it('encodes the expiry from the expiresInMs argument (seconds)', async () => {
      const key = uniqueKey('expiry.txt')
      const url = await getSignedUploadUrl(key, 'text/plain', 5 * 60 * 1000)
      const expires = new URL(url).searchParams.get('X-Amz-Expires')
      expect(expires).toBe('300')
    })

    it('uses the default 1h expiry for downloads when omitted', async () => {
      const key = uniqueKey('dl-expiry.txt')
      await uploadFile(key, 'x', 'text/plain')
      const url = await getSignedDownloadUrl(key)
      const expires = new URL(url).searchParams.get('X-Amz-Expires')
      expect(expires).toBe('3600')
    })

    it('floors a sub-second expiresInMs to 0 seconds (documents Math.floor behavior)', async () => {
      const key = uniqueKey('subsec.txt')
      const url = await getSignedUploadUrl(key, 'text/plain', 500)
      const expires = new URL(url).searchParams.get('X-Amz-Expires')
      expect(expires).toBe('0')
    })

    it('a download URL for a missing object returns 404 when fetched', async () => {
      const key = `adapter-s3-test/signed-missing-${randomUUID()}.txt`
      const url = await getSignedDownloadUrl(key)
      const resp = await fetch(url)
      expect(resp.status).toBe(404)
    })
  })

  describe('agentFileKey integration (tenant-scoped layout)', () => {
    it('round-trips an object stored under the agent file key', async () => {
      const tenantId = `tn-${randomUUID()}`
      const agentId = `ag-${randomUUID()}`
      const key = agentFileKey(tenantId, agentId, 'manual.txt')
      createdKeys.push(key)
      await uploadFile(key, 'tenant scoped content', 'text/plain')
      expect(key.startsWith(`tenants/${tenantId}/agents/${agentId}/files/`)).toBe(true)
      const buf = await downloadFile(key)
      expect(buf.toString('utf8')).toBe('tenant scoped content')
    })

    it('two tenants with the same file name do not collide', async () => {
      const agentId = `ag-${randomUUID()}`
      const fileName = 'shared.txt'
      const keyA = agentFileKey(`tnA-${randomUUID()}`, agentId, fileName)
      const keyB = agentFileKey(`tnB-${randomUUID()}`, agentId, fileName)
      createdKeys.push(keyA, keyB)
      await uploadFile(keyA, 'tenant A data', 'text/plain')
      await uploadFile(keyB, 'tenant B data', 'text/plain')
      expect((await downloadFile(keyA)).toString('utf8')).toBe('tenant A data')
      expect((await downloadFile(keyB)).toString('utf8')).toBe('tenant B data')
    })
  })
})
