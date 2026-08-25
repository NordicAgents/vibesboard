/**
 * Extract website addresses a user has typed, accepting both full URLs and
 * the common bare-domain form (for example, `example.com`).
 */
export function extractWebsiteUrls(value: string): string[] {
  const matches = value.match(
    /https?:\/\/[^\s)>\]]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?:\/[^\s)>\]]*)?/gi
  )

  return [
    ...new Set(
      (matches ?? []).flatMap(match => {
        const candidate = match.replace(/[.,!?;:]+$/, '')
        const normalized = /^https?:\/\//i.test(candidate)
          ? candidate
          : `https://${candidate}`

        try {
          const url = new URL(normalized)
          return url.protocol === 'http:' || url.protocol === 'https:'
            ? [url.toString().replace(/\/$/, '')]
            : []
        } catch {
          return []
        }
      })
    )
  ]
}
