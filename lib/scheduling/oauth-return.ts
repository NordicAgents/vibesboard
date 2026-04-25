const SAFE_ORIGIN = 'https://vibesboard.local'

export function getSafeSchedulingReturnTo(
  value: string | null | undefined
): string | null {
  if (!value) return null
  if (!value.startsWith('/') || value.startsWith('//')) return null

  try {
    const url = new URL(value, SAFE_ORIGIN)
    const isAgentPath =
      url.pathname === '/agents' || url.pathname.startsWith('/agents/')
    if (url.origin !== SAFE_ORIGIN || !isAgentPath) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function buildGoogleCalendarAuthPath(returnTo?: string | null): string {
  const safeReturnTo = getSafeSchedulingReturnTo(returnTo)
  if (!safeReturnTo) return '/api/scheduling/auth/google'

  const params = new URLSearchParams({ returnTo: safeReturnTo })
  return `/api/scheduling/auth/google?${params.toString()}`
}

export function appendSchedulingOAuthStatus(
  returnTo: string | null | undefined,
  key: 'scheduling_connected' | 'scheduling_error',
  value: string
): string {
  const safeReturnTo = getSafeSchedulingReturnTo(returnTo) ?? '/agents'
  const url = new URL(safeReturnTo, SAFE_ORIGIN)
  url.searchParams.set(key, value)
  return `${url.pathname}${url.search}${url.hash}`
}
