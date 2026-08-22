import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  getGoogleSheetsAuthUrl,
  exchangeCode,
  refreshAccessToken,
  getUserEmail,
  listSpreadsheets,
} from '../google-sheets-auth.ts'

// All of these hit Google over fetch; stub it so tests are offline + deterministic.
const realFetch = globalThis.fetch

const savedEnv = {
  id: process.env.GOOGLE_SHEETS_CLIENT_ID,
  secret: process.env.GOOGLE_SHEETS_CLIENT_SECRET,
  calId: process.env.GOOGLE_CALENDAR_CLIENT_ID,
  calSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
}

beforeEach(() => {
  process.env.GOOGLE_SHEETS_CLIENT_ID = 'sheets-client-id'
  process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'sheets-client-secret'
  delete process.env.GOOGLE_CALENDAR_CLIENT_ID
  delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
})

afterEach(() => {
  globalThis.fetch = realFetch
  process.env.GOOGLE_SHEETS_CLIENT_ID = savedEnv.id
  process.env.GOOGLE_SHEETS_CLIENT_SECRET = savedEnv.secret
  if (savedEnv.calId) process.env.GOOGLE_CALENDAR_CLIENT_ID = savedEnv.calId
  else delete process.env.GOOGLE_CALENDAR_CLIENT_ID
  if (savedEnv.calSecret)
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = savedEnv.calSecret
  else delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
})

function stubFetch(response: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    calls.push({ url: typeof url === 'string' ? url : String(url), init })
    return response
  }) as unknown as typeof fetch
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('getGoogleSheetsAuthUrl', () => {
  it('builds a consent URL with all required params', () => {
    const url = getGoogleSheetsAuthUrl('state-123', 'https://app/callback')
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    )
    expect(parsed.searchParams.get('client_id')).toBe('sheets-client-id')
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app/callback')
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('access_type')).toBe('offline')
    expect(parsed.searchParams.get('prompt')).toBe('consent')
    expect(parsed.searchParams.get('state')).toBe('state-123')
    expect(parsed.searchParams.get('scope')).toContain(
      'https://www.googleapis.com/auth/spreadsheets',
    )
  })

  it('falls back to the calendar client id when sheets id is unset', () => {
    delete process.env.GOOGLE_SHEETS_CLIENT_ID
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'calendar-client-id'
    const url = getGoogleSheetsAuthUrl('s', 'https://app/cb')
    expect(new URL(url).searchParams.get('client_id')).toBe('calendar-client-id')
  })

  it('throws when no client id is configured', () => {
    delete process.env.GOOGLE_SHEETS_CLIENT_ID
    delete process.env.GOOGLE_CALENDAR_CLIENT_ID
    expect(() => getGoogleSheetsAuthUrl('s', 'https://app/cb')).toThrow(
      /GOOGLE_SHEETS_CLIENT_ID/,
    )
  })
})

describe('exchangeCode', () => {
  it('exchanges an auth code for tokens (fetch stubbed)', async () => {
    const calls = stubFetch(
      jsonResponse({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
      }),
    )
    const before = Date.now()
    const tokens = await exchangeCode('the-code', 'https://app/cb')

    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(new Date(tokens.expiresAt).getTime()).toBeGreaterThanOrEqual(
      before + 3600_000 - 5000,
    )

    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[0].init?.method).toBe('POST')
    const body = (calls[0].init?.body as URLSearchParams).toString()
    expect(body).toContain('code=the-code')
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('client_secret=sheets-client-secret')
  })

  it('throws when the token endpoint returns an error', async () => {
    stubFetch(new Response('bad code', { status: 400 }))
    await expect(exchangeCode('x', 'https://app/cb')).rejects.toThrow(
      /Google token exchange failed \(400\): bad code/,
    )
  })

  it('throws when the client secret is not configured', async () => {
    delete process.env.GOOGLE_SHEETS_CLIENT_SECRET
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    await expect(exchangeCode('x', 'https://app/cb')).rejects.toThrow(
      /GOOGLE_SHEETS_CLIENT_SECRET/,
    )
  })
})

describe('refreshAccessToken', () => {
  it('refreshes a token (fetch stubbed)', async () => {
    const calls = stubFetch(
      jsonResponse({ access_token: 'new-at', expires_in: 1800 }),
    )
    const result = await refreshAccessToken('the-refresh')
    expect(result.accessToken).toBe('new-at')
    expect(typeof result.expiresAt).toBe('string')

    const body = (calls[0].init?.body as URLSearchParams).toString()
    expect(body).toContain('refresh_token=the-refresh')
    expect(body).toContain('grant_type=refresh_token')
  })

  it('throws on a non-ok refresh response', async () => {
    stubFetch(new Response('expired', { status: 401 }))
    await expect(refreshAccessToken('rt')).rejects.toThrow(
      /Google Sheets token refresh failed \(401\): expired/,
    )
  })
})

describe('getUserEmail', () => {
  it('returns the email from the userinfo endpoint', async () => {
    const calls = stubFetch(jsonResponse({ email: 'me@example.com' }))
    const email = await getUserEmail('access-tok')
    expect(email).toBe('me@example.com')
    expect(calls[0].url).toBe('https://www.googleapis.com/oauth2/v2/userinfo')
    expect(
      (calls[0].init?.headers as Record<string, string>).Authorization,
    ).toBe('Bearer access-tok')
  })

  it('throws when userinfo fails', async () => {
    stubFetch(new Response('nope', { status: 403 }))
    await expect(getUserEmail('tok')).rejects.toThrow(
      /Failed to fetch Google user info/,
    )
  })
})

describe('listSpreadsheets', () => {
  it('maps Drive files to {id, name}', async () => {
    const calls = stubFetch(
      jsonResponse({
        files: [
          { id: 'a', name: 'Budget' },
          { id: 'b', name: 'Leads' },
        ],
      }),
    )
    const sheets = await listSpreadsheets('tok')
    expect(sheets).toEqual([
      { id: 'a', name: 'Budget' },
      { id: 'b', name: 'Leads' },
    ])
    expect(calls[0].url).toContain('https://www.googleapis.com/drive/v3/files')
    expect(calls[0].url).toContain(
      encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet'"),
    )
  })

  it('returns an empty array when files is absent', async () => {
    stubFetch(jsonResponse({}))
    expect(await listSpreadsheets('tok')).toEqual([])
  })

  it('throws on a non-ok list response', async () => {
    stubFetch(new Response('forbidden', { status: 403 }))
    await expect(listSpreadsheets('tok')).rejects.toThrow(
      /Failed to list Google spreadsheets/,
    )
  })
})
