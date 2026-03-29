const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email'
]

function getClientId(): string {
  const id = process.env.GOOGLE_CALENDAR_CLIENT_ID
  if (!id) throw new Error('GOOGLE_CALENDAR_CLIENT_ID is not set')
  return id
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  if (!secret) throw new Error('GOOGLE_CALENDAR_CLIENT_SECRET is not set')
  return secret
}

function getRedirectUri(): string {
  const uri = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  if (!uri) throw new Error('GOOGLE_CALENDAR_REDIRECT_URI is not set')
  return uri
}

/**
 * Build the Google OAuth consent URL.
 * @param state - opaque state string (JSON-encoded tenantId + redirect info)
 */
export function getGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

interface TokenResponse {
  accessToken: string
  refreshToken: string
  expiresAt: string
}

/**
 * Exchange an authorization code for access + refresh tokens.
 */
export async function exchangeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code'
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token exchange failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt
  }
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: 'refresh_token'
    })
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google token refresh failed (${res.status}): ${text}`)
  }

  const data = await res.json()
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  return {
    accessToken: data.access_token,
    expiresAt
  }
}

/**
 * Fetch the Google user's email address using their access token.
 */
export async function getUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  })

  if (!res.ok) {
    throw new Error('Failed to fetch Google user info')
  }

  const data = await res.json()
  return data.email
}

/**
 * List the user's writable calendars.
 */
export async function listCalendars(
  accessToken: string
): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )

  if (!res.ok) {
    throw new Error('Failed to list Google calendars')
  }

  const data = await res.json()
  return (data.items ?? []).map((cal: any) => ({
    id: cal.id,
    summary: cal.summary,
    primary: cal.primary === true
  }))
}
