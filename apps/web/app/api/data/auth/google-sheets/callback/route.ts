import { NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'
import { requireAuth, requireTenantAdmin } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import {
  exchangeCode,
  getUserEmail,
  listSpreadsheets
} from '@vibesboard/data/google-sheets-auth'
import { createDataConnection } from '@vibesboard/data/connections'
import { getCanonicalOrigin } from '@/lib/app-url'
import { SHEETS_OAUTH_NONCE_COOKIE } from '../route'

export const runtime = 'nodejs'

async function getAppOrigin(fallback: string): Promise<string> {
  const h = await headers()
  const host = (h.get('x-forwarded-host') || h.get('host'))
    ?.split(',')[0]
    ?.trim()
  const headerOrigin = host ? `${proto(h)}://${host}` : fallback
  return getCanonicalOrigin(headerOrigin)
}

function proto(h: Headers): string {
  return (
    (h.get('x-forwarded-proto') || 'https').split(',')[0]?.trim() || 'https'
  )
}

/**
 * GET /api/data/auth/google-sheets/callback
 * Handles the OAuth callback from Google for Sheets access.
 * Unlike the scheduling callback, this verifies the user session.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const stateParam = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const appOrigin = await getAppOrigin(url.origin)

  if (error) {
    return NextResponse.redirect(
      new URL(`/agents?data_error=${encodeURIComponent(error)}`, appOrigin)
    )
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(
      new URL('/agents?data_error=missing_params', appOrigin)
    )
  }

  // Verify the user is authenticated (fix for auth bypass in scheduling callback)
  const authResult = await requireAuth()
  if (!authResult.ok) {
    return NextResponse.redirect(
      new URL('/agents?data_error=not_authenticated', appOrigin)
    )
  }

  let state: { tenantId: string; userId: string; nonce?: string }
  try {
    state = JSON.parse(stateParam)
  } catch {
    return NextResponse.redirect(
      new URL('/agents?data_error=invalid_state', appOrigin)
    )
  }

  // Verify the CSRF nonce — must match the cookie set at initiation. Clear it
  // unconditionally (single-use). Runs before the code exchange so a tampered
  // or replayed callback is rejected before any account linking.
  const cookieStore = await cookies()
  const storedNonce = cookieStore.get(SHEETS_OAUTH_NONCE_COOKIE)?.value
  cookieStore.delete(SHEETS_OAUTH_NONCE_COOKIE)
  if (!storedNonce || !state.nonce || storedNonce !== state.nonce) {
    return NextResponse.redirect(
      new URL('/agents?data_error=invalid_nonce', appOrigin)
    )
  }

  // Verify the authenticated user matches the state
  if (authResult.user.id !== state.userId) {
    return NextResponse.redirect(
      new URL('/agents?data_error=user_mismatch', appOrigin)
    )
  }

  // Resolve tenantId from the authenticated user's session, not from state
  const tenantId = await getActiveTenant(authResult.user.id)
  if (!tenantId) {
    return NextResponse.redirect(
      new URL('/agents?data_error=no_tenant', appOrigin)
    )
  }

  const adminResult = await requireTenantAdmin(tenantId)
  if (!adminResult.ok) {
    return NextResponse.redirect(
      new URL('/agents?data_error=forbidden', appOrigin)
    )
  }

  try {
    // Build the same redirect URI that was used in the auth initiation
    const redirectUri = `${appOrigin}/api/data/auth/google-sheets/callback`

    // Exchange code for tokens
    const tokens = await exchangeCode(code, redirectUri)

    // Get user email
    const email = await getUserEmail(tokens.accessToken)

    // Store the connection (spreadsheet selection happens in UI)
    const connection = await createDataConnection({
      provider: 'google_sheets',
      tenantId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
      email,
      spreadsheetId: '', // will be selected in UI
      sheetName: 'Sheet1',
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.email'
      ],
      connectedBy: authResult.user.id,
      name: `Google Sheets (${email})`
    })

    return NextResponse.redirect(
      new URL(
        `/agents?data_connected=true&connectionId=${connection.id}`,
        appOrigin
      )
    )
  } catch (err) {
    console.error('Google Sheets OAuth callback error:', err)
    return NextResponse.redirect(
      new URL('/agents?data_error=oauth_failed', appOrigin)
    )
  }
}
