import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requireAuth } from '@/lib/firebase/route-handler'
import { getActiveTenant } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import { getGoogleSheetsAuthUrl } from '@/lib/data/google-sheets-auth'

export const runtime = 'nodejs'

const CALLBACK_PATH = '/api/data/auth/google-sheets/callback'

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

  const enabled = await isFeatureEnabled(tenantId, 'AGENT_ACTIONS_DATA')
  if (!enabled) {
    return NextResponse.json(
      { error: 'Data actions feature is not enabled' },
      { status: 403 }
    )
  }

  const h = await headers()
  const host = (h.get('x-forwarded-host') || h.get('host'))?.split(',')[0]?.trim()
  const proto = (h.get('x-forwarded-proto') || 'https').split(',')[0]?.trim()
  const origin = host ? `${proto}://${host}` : new URL(req.url).origin
  const redirectUri = `${origin}${CALLBACK_PATH}`

  const state = JSON.stringify({ tenantId, userId: user.id })
  const authUrl = getGoogleSheetsAuthUrl(state, redirectUri)

  return NextResponse.redirect(authUrl)
}
