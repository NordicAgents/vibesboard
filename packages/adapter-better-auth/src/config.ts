import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { uuidv7 } from 'uuidv7'
import { getDb } from '@vibesboard/adapter-postgres/client'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { sendMagicLinkEmail, sendVerifyEmail, sendResetPasswordEmail } from './email.ts'
import { onUserCreateAfter } from './on-user-create.ts'

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function buildAuth() {
  return betterAuth({
  database: drizzleAdapter(getDb(), {
    provider: 'pg',
    schema,
    usePlural: true,
  }),
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET || 'dev-secret-change-me',
  // Our schema uses uuid columns; Better Auth's default ID generator emits
  // nanoids which would fail the uuid CHECK. Route through uuidv7.
  advanced: { database: { generateId: () => uuidv7() } },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: ({ user, url }) => sendResetPasswordEmail({ user, url }),
  },
  emailVerification: {
    sendVerificationEmail: ({ user, url }) => sendVerifyEmail({ user, url }),
  },
  socialProviders: {
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? {
          google: {
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          },
        }
      : {}),
  },
  plugins: [
    magicLink({
      sendMagicLink: ({ email, url }) => sendMagicLinkEmail({ email, url }),
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        after: (user) => onUserCreateAfter(user),
      },
    },
  },
  })
}

type AuthInstance = ReturnType<typeof buildAuth>

let _auth: AuthInstance | undefined

/**
 * Lazy singleton — the underlying drizzleAdapter calls getDb() which reads
 * DATABASE_URL at first use. Deferring creation lets `next build` import this
 * module without touching the env (build-time prerendering doesn't actually
 * invoke any auth method).
 */
export const auth = new Proxy({} as AuthInstance, {
  get(_target, prop) {
    if (!_auth) _auth = buildAuth()
    return Reflect.get(_auth as object, prop)
  },
})

export type Auth = AuthInstance
