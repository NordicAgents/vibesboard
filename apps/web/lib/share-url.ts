const firstHeaderValue = (value: string | null): string | null =>
  value?.split(',')[0]?.trim() || null

/** Build the public URL for an agent consistently behind proxies and locally. */
export function buildShareUrl(
  requestHeaders: Pick<Headers, 'get'>,
  tenantSlug: string | null | undefined,
  agentSlug: string,
  configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL
): string {
  const host = firstHeaderValue(
    requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
  )
  const protocol =
    firstHeaderValue(requestHeaders.get('x-forwarded-proto')) ??
    (host?.startsWith('localhost') ? 'http' : 'https')
  const origin =
    (host ? `${protocol}://${host}` : configuredAppUrl) ??
    'http://localhost:3000'

  return `${origin.replace(/\/$/, '')}/${tenantSlug ?? 'unknown'}/${agentSlug}`
}
