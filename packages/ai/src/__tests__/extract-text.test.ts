import { describe, expect, it } from 'vitest'

import {
  extractTextFromBuffer,
  UnsupportedFileTypeError,
} from '../file-search.ts'

// Byte signatures of the real containers these MIME types describe. The point
// of these tests is that a binary container must never fall through to the
// lossy text decoder: mojibake is non-empty, so it would pass the
// "has extractable text" check and get indexed as if it were readable.
const OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00])

describe('extractTextFromBuffer — unsupported formats', () => {
  const cases: Array<[string, string, Buffer]> = [
    ['PowerPoint .pptx',
     'application/vnd.openxmlformats-officedocument.presentationml.presentation',
     ZIP_HEADER],
    ['PowerPoint .ppt', 'application/vnd.ms-powerpoint', OLE_HEADER],
    ['legacy Word .doc', 'application/msword', OLE_HEADER],
    ['legacy Excel .xls', 'application/vnd.ms-excel', OLE_HEADER],
  ]

  for (const [label, mimeType, buffer] of cases) {
    it(`rejects ${label} instead of indexing decoded binary`, async () => {
      await expect(extractTextFromBuffer(buffer, mimeType)).rejects.toThrow(
        UnsupportedFileTypeError,
      )
    })

    it(`tells the uploader what to do instead for ${label}`, async () => {
      await expect(
        extractTextFromBuffer(buffer, mimeType),
      ).rejects.toThrow(/PDF, DOCX, XLSX, or plain text/)
    })
  }
})

describe('extractTextFromBuffer — HTML', () => {
  const HTML = Buffer.from(
    `<!doctype html><html><head><title>T</title>
     <style>.a{color:red}</style><script>var x=1;</script></head>
     <body><h1>Support hours</h1><p>Weekdays 9 to 5.</p></body></html>`,
  )

  it('extracts readable text rather than markup', async () => {
    const text = await extractTextFromBuffer(HTML, 'text/html')
    expect(text).toContain('Support hours')
    expect(text).toContain('Weekdays 9 to 5.')
  })

  it('drops tags, script and style bodies', async () => {
    const text = await extractTextFromBuffer(HTML, 'text/html')
    // Regression: text/html used to fall into the generic text/ branch, which
    // indexed the raw source, so all of this ended up in the vector store.
    expect(text).not.toContain('<h1>')
    expect(text).not.toContain('var x=1')
    expect(text).not.toContain('color:red')
  })
})

describe('extractTextFromBuffer — supported formats still work', () => {
  it('reads plain text', async () => {
    const text = await extractTextFromBuffer(
      Buffer.from('hello world'),
      'text/plain',
    )
    expect(text).toContain('hello world')
  })

  it('reads markdown', async () => {
    const text = await extractTextFromBuffer(
      Buffer.from('# Title\n\nbody'),
      'text/markdown',
    )
    expect(text).toContain('Title')
  })

  it('reads json', async () => {
    const text = await extractTextFromBuffer(
      Buffer.from('{"k":"v"}'),
      'application/json',
    )
    expect(text).toContain('"k"')
  })
})
