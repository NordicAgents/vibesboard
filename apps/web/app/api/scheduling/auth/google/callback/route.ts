import { NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import {
  exchangeCode,
  getUserEmail,
  listCalendars
} from '@vibesboard/scheduling/google-auth'
import { createCalendarConnection } from '@vibesboard/scheduling/connections'
import {
  appendSchedulingOAuthStatus,
  getSafeSchedulingReturnTo
} from '@vibesboard/scheduling/oauth-return'
import { OAUTH_NONCE_COOKIE } from '../route'

export const runtime = 'nodejs'

async function getAppOrigin(fallback: string): Promise<string> {
  const h = await headers()
  const host = (h.get('x-forwarded-host') || h.get('host'))
    ?.split(',')[0]
    ?.trim()
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0]?.trim()
  if (host) return `${proto}://${host}`
  return fallback
}

function getReturnToFromStateParam(stateParam: string | null): string | null {
  if (!stateParam) return null
  try {
    const parsed = JSON.parse(stateParam) as { returnTo?: unknown }
    return typeof parsed.returnTo === 'string'
      ? getSafeSchedulingReturnTo(parsed.returnTo)
      : null
  } catch {
    return null
  }
}

function getSchedulingRedirectUrl(
  appOrigin: string,
  returnTo: string | null | undefined,
  key: 'scheduling_connected' | 'scheduling_error',
  value: string
): URL {
  return new URL(appendSchedulingOAuthStatus(returnTo, key, value), appOrigin)
}

/**
 * GET /api/scheduling/auth/google/callback
 * Handles the OAuth callback from Google, exchanges the code for tokens,
 * and stores the calendar connection.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const appOrigin = await getAppOrigin(url.origin)
  const stateReturnTo = getReturnToFromStateParam(stateParam)

  if (error) {
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        stateReturnTo,
        'scheduling_error',
        error
      )
    )
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        stateReturnTo,
        'scheduling_error',
        'missing_params'
      )
    )
  }

  // Verify the user is authenticated
  const authResult = await requireAuth()
  if (!authResult.ok) {
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        stateReturnTo,
        'scheduling_error',
        'not_authenticated'
      )
    )
  }

  let state: {
    tenantId: string
    userId: string
    nonce?: string
    returnTo?: string
  }
  try {
    state = JSON.parse(stateParam)
  } catch {
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        stateReturnTo,
        'scheduling_error',
        'invalid_state'
      )
    )
  }

  const returnTo = getSafeSchedulingReturnTo(state.returnTo)

  // Verify CSRF nonce — must match the cookie set at OAuth initiation.
  // Always clear the cookie regardless of outcome (single-use).
  const cookieStore = await cookies()
  const storedNonce = cookieStore.get(OAUTH_NONCE_COOKIE)?.value
  cookieStore.delete(OAUTH_NONCE_COOKIE)

  if (!storedNonce || !state.nonce || storedNonce !== state.nonce) {
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        returnTo,
        'scheduling_error',
        'invalid_nonce'
      )
    )
  }

  // Verify the authenticated user matches the state
  if (authResult.user.id !== state.userId) {
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        returnTo,
        'scheduling_error',
        'user_mismatch'
      )
    )
  }

  // Resolve tenantId from the authenticated user's session, not from state
  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) {
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        returnTo,
        'scheduling_error',
        'no_tenant'
      )
    )
  }

  try {
    // Build the same redirect URI that was used in the auth initiation
    const redirectUri = `${appOrigin}/api/scheduling/auth/google/callback`

    // Exchange code for tokens
    const tokens = await exchangeCode(code, redirectUri)

    // Get user email and calendars
    const email = await getUserEmail(tokens.accessToken)
    const calendars = await listCalendars(tokens.accessToken)

    // Use primary calendar, or first available
    const primaryCalendar = calendars.find(c => c.primary) ?? calendars[0]
    if (!primaryCalendar) {
      return NextResponse.redirect(
        getSchedulingRedirectUrl(
          appOrigin,
          returnTo,
          'scheduling_error',
          'no_calendars'
        )
      )
    }

    // Store the connection
    await createCalendarConnection({
      tenantId,
      provider: 'google_calendar',
      name: email,
      calendarId: primaryCalendar.id,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      email,
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email'
      ],
      connectedBy: authResult.user.id
    })

    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        returnTo,
        'scheduling_connected',
        'true'
      )
    )
  } catch (err) {
    console.error('Google Calendar OAuth callback error:', err)
    return NextResponse.redirect(
      getSchedulingRedirectUrl(
        appOrigin,
        returnTo,
        'scheduling_error',
        'oauth_failed'
      )
    )
  }
}
