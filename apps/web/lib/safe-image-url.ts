const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

/** Return a browser-safe remote image URL, or null for executable/invalid URLs. */
export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null

  if (
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
  ) {
    return value
  }

  try {
    const parsed = new URL(value)
    return HTTP_PROTOCOLS.has(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

export function isGoogleStorageImageUrl(value: string): boolean {
  const safe = safeImageUrl(value)
  if (!safe) return false

  const hostname = new URL(safe).hostname.toLowerCase()
  return (
    hostname === 'storage.googleapis.com' ||
    hostname.endsWith('.storage.googleapis.com')
  )
}
