import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { exchangeCode, getUserEmail, listCalendars } from '@/lib/scheduling/google-auth'
import { createCalendarConnection } from '@/lib/scheduling/connections'

export const runtime = 'nodejs'

async function getAppOrigin(fallback: string): Promise<string> {
  const h = await headers()
  const host = (h.get('x-forwarded-host') || h.get('host'))?.split(',')[0]?.trim()
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0]?.trim()
  if (host) return `${proto}://${host}`
  return fallback
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

  if (error) {
    return NextResponse.redirect(
      new URL(`/agents?scheduling_error=${encodeURIComponent(error)}`, appOrigin)
    )
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL('/agents?scheduling_error=missing_params', appOrigin)
    )
  }

  // Verify the user is authenticated
  const authResult = await requireAuth()
  if (!authResult.ok) {
    return NextResponse.redirect(
      new URL('/agents?scheduling_error=not_authenticated', appOrigin)
    )
  }

  let state: { tenantId: string; userId: string }
  try {
    state = JSON.parse(stateParam)
  } catch {
    return NextResponse.redirect(
      new URL('/agents?scheduling_error=invalid_state', appOrigin)
    )
  }

  // Verify the authenticated user matches the state
  if (authResult.user.id !== state.userId) {
    return NextResponse.redirect(
      new URL('/agents?scheduling_error=user_mismatch', appOrigin)
    )
  }

  // Resolve tenantId from the authenticated user's session, not from state
  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) {
    return NextResponse.redirect(
      new URL('/agents?scheduling_error=no_tenant', appOrigin)
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
        new URL('/agents?scheduling_error=no_calendars', appOrigin)
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
      new URL('/agents?scheduling_connected=true', appOrigin)
    )
  } catch (err) {
    console.error('Google Calendar OAuth callback error:', err)
    return NextResponse.redirect(
      new URL('/agents?scheduling_error=oauth_failed', appOrigin)
    )
  }
}
