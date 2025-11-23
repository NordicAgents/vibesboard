import { type SupabaseClient } from '@supabase/supabase-js'

import { type Database } from '@/lib/db_types'

const MAX_FILE_COUNT = 5
const MAX_CHAR_COUNT = 12000

export async function fetchAgentFileContext({
  supabase,
  fileKeys
}: {
  supabase: SupabaseClient<Database>
  fileKeys: string[]
}) {
  if (!fileKeys?.length) {
    return null
  }

  const bucket = supabase.storage.from('agent-files')
  const chunks: string[] = []

  for (const key of fileKeys.slice(0, MAX_FILE_COUNT)) {
    const { data, error } = await bucket.createSignedUrl(key, 60 * 5)
    if (error || !data?.signedUrl) {
      continue
    }

    try {
      const res = await fetch(data.signedUrl)
      if (!res.ok) continue
      const ctype = (res.headers.get('content-type') || '').toLowerCase()
      const isText =
        ctype.startsWith('text/') ||
        ctype.includes('json') ||
        ctype.includes('markdown') ||
        ctype.includes('csv') ||
        ctype.includes('xml')

      if (!isText) {
        // Skip binary content to avoid dumping gibberish into the prompt.
        // Leave a short marker so users know why context may be missing.
        chunks.push(`File: ${key}\n[Non-text file (${ctype || 'unknown content-type'}) omitted]`)
      } else {
        const text = await res.text()
        chunks.push(`File: ${key}\n${text}`)
      }
      if (chunks.join('\n\n').length > MAX_CHAR_COUNT) {
        break
      }
    } catch (error) {
      continue
    }
  }

  const combined = chunks.join('\n\n').slice(0, MAX_CHAR_COUNT)
  return combined.length ? combined : null
}
