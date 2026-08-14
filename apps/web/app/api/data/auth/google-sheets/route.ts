import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'
import { requireAuth } from '@/lib/auth/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@vibesboard/policy/features'
import { getGoogleSheetsAuthUrl } from '@vibesboard/data/google-sheets-auth'
import { getCanonicalOrigin } from '@/lib/app-url'

export const runtime = 'nodejs'

const CALLBACK_PATH = '/api/data/auth/google-sheets/callback'
// Distinct from the scheduling nonce cookie so concurrent Sheets + Calendar
// OAuth flows do not clobber each other's CSRF nonce.
export const SHEETS_OAUTH_NONCE_COOKIE = 'sheets_oauth_csrf_nonce'

/**
 * GET /api/data/auth/google-sheets
 * Redirects the user to Google's OAuth consent screen for Sheets access.
 */
export async function GET(req: Request) {
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const user = authResult.user
  const tenantId = await getActiveTenant(user.id)

  if (!tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_ACTIONS')
  if (!enabled) {
    return NextResponse.json(
      { error: 'Data actions feature is not enabled' },
      { status: 403 }
    )
  }

  const h = await headers()
  const host = (h.get('x-forwarded-host') || h.get('host'))
    ?.split(',')[0]
    ?.trim()
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0]?.trim()
  const headerOrigin = host ? `${proto}://${host}` : new URL(req.url).origin
  const origin = getCanonicalOrigin(headerOrigin)
  const redirectUri = `${origin}${CALLBACK_PATH}`

  // CSRF protection: random nonce in an httpOnly cookie, echoed in OAuth state;
  // the callback rejects the code unless they match (single-use). Without this
  // an attacker can craft a callback that links THEIR Google account to a
  // victim's workspace.
  const nonce = randomBytes(16).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set(SHEETS_OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes — enough for the OAuth round-trip
    path: '/'
  })

  const state = JSON.stringify({ tenantId, userId: user.id, nonce })
  const authUrl = getGoogleSheetsAuthUrl(state, redirectUri)

  return NextResponse.redirect(authUrl)
}
