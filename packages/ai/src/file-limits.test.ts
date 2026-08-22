import { describe, expect, it } from 'vitest'

import {
  FileProcessingLimitError,
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_EXTRACTED_TEXT_CHARS,
  assertArchiveMetadataWithinLimits,
  assertExtractedTextWithinLimits
} from './file-limits.ts'

describe('file processing limits', () => {
  it('rejects archives whose declared expansion exceeds the byte budget', () => {
    expect(() =>
      assertArchiveMetadataWithinLimits({
        archiveBytes: 1024,
        entryCount: 2,
        uncompressedBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES + 1
      })
    ).toThrow(FileProcessingLimitError)
  })

  it('rejects archives with too many entries', () => {
    expect(() =>
      assertArchiveMetadataWithinLimits({
        archiveBytes: 1024,
        entryCount: MAX_ARCHIVE_ENTRIES + 1,
        uncompressedBytes: 2048
      })
    ).toThrow(/too many entries/i)
  })

  it('rejects excessive compression ratios', () => {
    expect(() =>
      assertArchiveMetadataWithinLimits({
        archiveBytes: 100,
        entryCount: 1,
        uncompressedBytes: 20_000
      })
    ).toThrow(/compression ratio/i)
  })

  it('rejects extracted text that would create an unbounded embedding job', () => {
    expect(() =>
      assertExtractedTextWithinLimits('x'.repeat(MAX_EXTRACTED_TEXT_CHARS + 1))
    ).toThrow(/extracted text/i)
  })
})
