import { getSignedDownloadUrl } from '@/lib/firebase/storage'

const MAX_FILE_COUNT = 5
const MAX_CHAR_COUNT = 12000

export async function fetchAgentFileContext({
  fileKeys
}: {
  fileKeys: string[]
}) {
  if (!fileKeys?.length) {
    return null
  }

  const chunks: string[] = []

  for (const key of fileKeys.slice(0, MAX_FILE_COUNT)) {
    try {
      const signedUrl = await getSignedDownloadUrl(key, 5 * 60 * 1000)

      const res = await fetch(signedUrl)
      if (!res.ok) continue
      const ctype = (res.headers.get('content-type') || '').toLowerCase()
      const isText =
        ctype.startsWith('text/') ||
        ctype.includes('json') ||
        ctype.includes('markdown') ||
        ctype.includes('csv') ||
        ctype.includes('xml')

      if (!isText) {
        chunks.push(
          `File: ${key}\n[Non-text file (${ctype || 'unknown content-type'}) omitted]`
        )
      } else {
        const text = await res.text()
        chunks.push(`File: ${key}\n${text}`)
      }
      if (chunks.join('\n\n').length > MAX_CHAR_COUNT) {
        break
      }
    } catch {
      continue
    }
  }

  const combined = chunks.join('\n\n').slice(0, MAX_CHAR_COUNT)
  return combined.length ? combined : null
}
