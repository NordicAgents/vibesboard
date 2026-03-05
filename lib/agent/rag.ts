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

  const chunks = await Promise.all(
    fileKeys.slice(0, MAX_FILE_COUNT).map(async (key): Promise<string | null> => {
      try {
        const signedUrl = await getSignedDownloadUrl(key, 5 * 60 * 1000)
        const res = await fetch(signedUrl)
        if (!res.ok) return null
        const ctype = (res.headers.get('content-type') || '').toLowerCase()
        const isText =
          ctype.startsWith('text/') ||
          ctype.includes('json') ||
          ctype.includes('markdown') ||
          ctype.includes('csv') ||
          ctype.includes('xml')

        if (!isText) {
          return `File: ${key}\n[Non-text file (${ctype || 'unknown content-type'}) omitted]`
        }
        const text = await res.text()
        return `File: ${key}\n${text}`
      } catch {
        return null
      }
    })
  )

  const combined = chunks.filter(Boolean).join('\n\n').slice(0, MAX_CHAR_COUNT)
  return combined.length ? combined : null
}
