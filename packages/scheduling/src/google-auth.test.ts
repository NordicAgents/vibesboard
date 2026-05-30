import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  exchangeCode,
  getGoogleAuthUrl,
  getUserEmail,
  listCalendars,
  refreshAccessToken,
} from './google-auth.ts'

// These functions read Google OAuth client credentials from the environment
// and call the Google token/userinfo endpoints via fetch. We stub fetch and
// set the env vars per-test.
const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID
const ORIGINAL_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET

beforeEach(() => {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = 'client-123'
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'secret-xyz'
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  if (ORIGINAL_CLIENT_ID === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_ID
  else process.env.GOOGLE_CALENDAR_CLIENT_ID = ORIGINAL_CLIENT_ID
  if (ORIGINAL_CLIENT_SECRET === undefined) delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  else process.env.GOOGLE_CALENDAR_CLIENT_SECRET = ORIGINAL_CLIENT_SECRET
  vi.restoreAllMocks()
})

describe('getGoogleAuthUrl', () => {
  it('builds the consent URL with offline access, forced consent, scopes and state', () => {
    const url = getGoogleAuthUrl('opaque-state', 'https://app/callback')
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(parsed.searchParams.get('client_id')).toBe('client-123')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app/callback')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
    expect(parsed.searchParams.get('state')).toBe('opaque-state')
    const scope = parsed.searchParams.get('scope') ?? ''
    expect(scope).toContain('https://www.googleapis.com/auth/calendar')
    expect(scope).toContain('https://www.googleapis.com/auth/calendar.events')
    expect(scope).toContain('https://www.googleapis.com/auth/userinfo.email')
  })

  it('throws when the client id is not configured', () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    expect(() => getGoogleAuthUrl('s', 'https://app/cb')).toThrow(
      /GOOGLE_CALENDAR_CLIENT_ID is not set/,
    )
  })
})

describe('exchangeCode', () => {
  it('POSTs the auth-code grant and maps the token response', async () => {
    const fixedNow = new Date('2030-01-01T00:00:00Z').getTime()
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const tokens = await exchangeCode('the-code', 'https://app/callback')
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.expiresAt).toBe(new Date(fixedNow + 3600 * 1000).toISOString())

    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    )
    const body = new URLSearchParams((init.body as URLSearchParams).toString())
    expect(body.get('code')).toBe('the-code')
    expect(body.get('client_id')).toBe('client-123')
    expect(body.get('client_secret')).toBe('secret-xyz')
    expect(body.get('redirect_uri')).toBe('https://app/callback')
    expect(body.get('grant_type')).toBe('authorization_code')
  })

  it('throws with the status and body when the token endpoint fails', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('bad request', { status: 400 }),
    ) as unknown as typeof fetch
    await expect(exchangeCode('c', 'https://app/cb')).rejects.toThrow(
      /Google token exchange failed \(400\): bad request/,
    )
  })
})

describe('refreshAccessToken', () => {
  it('POSTs the refresh-token grant and maps access token + expiry', async () => {
    const fixedNow = new Date('2030-06-01T00:00:00Z').getTime()
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'fresh', expires_in: 1800 }), { status: 200 }),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const result = await refreshAccessToken('the-refresh-token')
    expect(result.accessToken).toBe('fresh')
    expect(result.expiresAt).toBe(new Date(fixedNow + 1800 * 1000).toISOString())

    const body = new URLSearchParams(
      ((spy.mock.calls[0][1] as RequestInit).body as URLSearchParams).toString(),
    )
    expect(body.get('refresh_token')).toBe('the-refresh-token')
    expect(body.get('grant_type')).toBe('refresh_token')
  })

  it('throws when the refresh endpoint returns a non-ok status', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('nope', { status: 401 }),
    ) as unknown as typeof fetch
    await expect(refreshAccessToken('rt')).rejects.toThrow(
      /Google token refresh failed \(401\): nope/,
    )
  })
})

describe('getUserEmail', () => {
  it('fetches userinfo with the bearer token and returns the email', async () => {
    const spy = vi.fn(
      async () => new Response(JSON.stringify({ email: 'me@example.com' }), { status: 200 }),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const email = await getUserEmail('access-tok')
    expect(email).toBe('me@example.com')
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://www.googleapis.com/oauth2/v2/userinfo')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-tok')
  })

  it('throws on a failed userinfo request', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 403 }),
    ) as unknown as typeof fetch
    await expect(getUserEmail('tok')).rejects.toThrow(/Failed to fetch Google user info/)
  })
})

describe('listCalendars', () => {
  it('requests writable calendars and maps id/summary/primary', async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            items: [
              { id: 'primary', summary: 'Personal', primary: true },
              { id: 'team@group', summary: 'Team' },
            ],
          }),
          { status: 200 },
        ),
    )
    globalThis.fetch = spy as unknown as typeof fetch

    const cals = await listCalendars('tok')
    expect(cals).toEqual([
      { id: 'primary', summary: 'Personal', primary: true },
      { id: 'team@group', summary: 'Team', primary: false },
    ])
    const [url, init] = spy.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/users/me/calendarList')
    expect(url).toContain('minAccessRole=writer')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('returns an empty array when there are no items', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    ) as unknown as typeof fetch
    expect(await listCalendars('tok')).toEqual([])
  })

  it('throws on a failed list request', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 500 }),
    ) as unknown as typeof fetch
    await expect(listCalendars('tok')).rejects.toThrow(/Failed to list Google calendars/)
  })
})
