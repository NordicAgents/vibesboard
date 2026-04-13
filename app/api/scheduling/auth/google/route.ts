import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { headers, cookies } from 'next/headers'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import { getGoogleAuthUrl } from '@/lib/scheduling/google-auth'

export const runtime = 'nodejs'

const CALLBACK_PATH = '/api/scheduling/auth/google/callback'
export const OAUTH_NONCE_COOKIE = 'oauth_csrf_nonce'

/**
 * GET /api/scheduling/auth/google
 * Redirects the user to Google's OAuth consent screen.
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
    return NextResponse.json({ error: 'Scheduling feature is not enabled' }, { status: 403 })
  }

  const h = await headers()
  const host = (h.get('x-forwarded-host') || h.get('host'))?.split(',')[0]?.trim()
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0]?.trim()
  const origin = host ? `${proto}://${host}` : new URL(req.url).origin
  const redirectUri = `${origin}${CALLBACK_PATH}`

  // Generate a random CSRF nonce, store it in an httpOnly cookie, and embed it
  // in the OAuth state param. The callback verifies they match before accepting
  // the code — prevents an attacker from tricking a user into completing a
  // crafted OAuth flow (CSRF on the OAuth callback).
  const nonce = randomBytes(16).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 10, // 10 minutes — enough for the OAuth round-trip
    path: '/'
  })

  const state = JSON.stringify({ tenantId, userId: user.id, nonce })
  const authUrl = getGoogleAuthUrl(state, redirectUri)

  return NextResponse.redirect(authUrl)
}
