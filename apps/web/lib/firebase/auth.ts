import 'server-only'
import { cookies } from 'next/headers'
import { adminAuth } from './admin'
import type { DecodedIdToken } from 'firebase-admin/auth'

const SESSION_COOKIE_NAME = '__session'
const SESSION_EXPIRY_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

export interface SessionUser {
  id: string
  email: string | undefined
  name: string | undefined
  image: string | undefined
}

/**
 * Verify the Firebase session cookie and return the decoded token.
 * Returns null if no cookie or invalid.
 */
export async function verifySessionCookie(): Promise<DecodedIdToken | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (!sessionCookie) return null

  try {
    return await adminAuth.verifySessionCookie(sessionCookie, true)
  } catch {
    return null
  }
}

/**
 * Drop-in replacement for the old `auth()` helper.
 * Returns a session-like object with user info, or null if unauthenticated.
 */
export async function auth(): Promise<{ user: SessionUser } | null> {
  const decoded = await verifySessionCookie()
  if (!decoded) return null

  return {
    user: {
      id: decoded.uid,
      email: decoded.email,
      name: decoded.name ?? decoded.email?.split('@')[0],
      image: decoded.picture
    }
  }
}

/**
 * Create a session cookie from a Firebase ID token.
 * Called from the POST /api/auth/session route.
 */
export async function createSessionCookie(idToken: string): Promise<string> {
  return adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_EXPIRY_MS
  })
}

/**
 * Cookie options for the session cookie.
 */
export function getSessionCookieOptions() {
  return {
    name: SESSION_COOKIE_NAME,
    maxAge: SESSION_EXPIRY_MS / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/'
  }
}

export { SESSION_COOKIE_NAME }
