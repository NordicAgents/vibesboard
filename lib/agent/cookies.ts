import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

const COOKIE_NAME = 'va_ext'
const COOKIE_TTL_DAYS = 30

export async function ensureExternalSessionId(opts?: {
  crossOrigin?: boolean
}) {
  const cookieStore = await cookies()
  const existing = cookieStore.get(COOKIE_NAME)?.value

  if (existing) {
    return existing
  }

  const value = randomUUID()
  cookieStore.set({
    name: COOKIE_NAME,
    value,
    httpOnly: true,
    sameSite: opts?.crossOrigin ? 'none' : 'lax',
    secure: true,
    maxAge: COOKIE_TTL_DAYS * 24 * 60 * 60,
    path: '/'
  })
  return value
}

export async function getExternalSessionId() {
  const cookieStore = await cookies()
  return cookieStore.get(COOKIE_NAME)?.value ?? null
}
