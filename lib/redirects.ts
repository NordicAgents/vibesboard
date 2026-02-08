export function getSafeRedirectPath(input: unknown): string | null {
  if (typeof input !== 'string') {
    return null
  }

  const value = input.trim()

  // Must be a relative path
  if (!value.startsWith('/')) {
    return null
  }

  // Block protocol-relative URLs and obvious header injection
  if (value.startsWith('//') || value.includes('\n') || value.includes('\r')) {
    return null
  }

  const lower = value.toLowerCase()
  if (
    lower.includes('http:') ||
    lower.includes('https:') ||
    lower.includes('javascript:')
  ) {
    return null
  }

  // Avoid path confusion in some user agents.
  if (value.includes('\\')) {
    return null
  }

  return value
}

