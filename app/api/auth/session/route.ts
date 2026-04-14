import 'server-only'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  createSessionCookie,
  getSessionCookieOptions,
  SESSION_COOKIE_NAME
} from '@/lib/firebase/auth'

/**
 * POST /api/auth/session
 * Receives a Firebase ID token from the client and creates a server-side session cookie.
 */
export async function POST(request: Request) {
  try {
    const { idToken } = await request.json()

    if (!idToken || typeof idToken !== 'string') {
      return NextResponse.json({ error: 'Missing idToken' }, { status: 400 })
    }

    const sessionCookie = await createSessionCookie(idToken)
    const cookieStore = await cookies()
    const opts = getSessionCookieOptions()

    cookieStore.set(opts.name, sessionCookie, {
      maxAge: opts.maxAge,
      httpOnly: opts.httpOnly,
      secure: opts.secure,
      sameSite: opts.sameSite,
      path: opts.path
    })

    return NextResponse.json({ status: 'ok' })
  } catch (error: any) {
    console.error('Session creation failed:', error?.message)
    return NextResponse.json(
      { error: 'Failed to create session' },
      { status: 401 }
    )
  }
}

/**
 * DELETE /api/auth/session
 * Clears the session cookie (sign out).
 */
export async function DELETE() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  return NextResponse.json({ status: 'ok' })
}
