import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_UPLOAD_FILE_TYPES,
  MAX_FILE_UPLOAD_BYTES,
  isAcceptedUploadMimeType,
  isValidUploadSize
} from './file-upload.ts'

describe('file upload policy', () => {
  it('accepts supported file types from one shared allowlist', () => {
    expect(isAcceptedUploadMimeType('application/pdf')).toBe(true)
    expect(isAcceptedUploadMimeType('text/plain')).toBe(true)
    expect(isAcceptedUploadMimeType('application/x-executable')).toBe(false)
  })

  it('does not offer legacy binary formats that the server cannot extract', () => {
    expect(ACCEPTED_UPLOAD_FILE_TYPES).toContain('.docx')
    expect(ACCEPTED_UPLOAD_FILE_TYPES).toContain('.xlsx')
    expect(ACCEPTED_UPLOAD_FILE_TYPES).not.toMatch(/(^|,)\.doc(,|$)/)
    expect(ACCEPTED_UPLOAD_FILE_TYPES).not.toMatch(/(^|,)\.xls(,|$)/)
  })

  it('enforces a positive 10 MB maximum on the server-declared size', () => {
    expect(isValidUploadSize(1)).toBe(true)
    expect(isValidUploadSize(MAX_FILE_UPLOAD_BYTES)).toBe(true)
    expect(isValidUploadSize(MAX_FILE_UPLOAD_BYTES + 1)).toBe(false)
    expect(isValidUploadSize(0)).toBe(false)
    expect(isValidUploadSize(Number.NaN)).toBe(false)
  })
})
