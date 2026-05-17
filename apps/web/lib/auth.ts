import 'server-only'
import { headers } from 'next/headers'
import { auth as betterAuth } from '@vibesboard/adapter-better-auth'

export interface SessionUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

export async function auth(): Promise<{ user: SessionUser } | null> {
  const session = await betterAuth.api.getSession({ headers: await headers() })
  if (!session?.user) return null
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      image: session.user.image ?? null
    }
  }
}
