import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { magicLink } from 'better-auth/plugins'
import { uuidv7 } from 'uuidv7'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { sendMagicLinkEmail, sendVerifyEmail, sendResetPasswordEmail } from './email.ts'
import { onUserCreateAfter } from './on-user-create.ts'

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function resolveSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  // `next build` sets NODE_ENV=production but does not inject runtime secrets.
  // getDb() short-circuits to a no-op proxy under the same NEXT_PHASE guard;
  // mirror that here so the auth instance can be constructed at prerender
  // time without throwing. No real auth call runs in this phase.
  if (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NEXT_PHASE === 'phase-export'
  ) {
    return 'build-time-placeholder-not-used'
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[adapter-better-auth] BETTER_AUTH_SECRET must be set in production. ' +
        'Generate one with: openssl rand -hex 32',
    )
  }
  // Dev fallback — print a loud warning so it doesn't slip into prod silently.
  console.warn(
    '[adapter-better-auth] BETTER_AUTH_SECRET is not set; using a public dev secret. ' +
      'DO NOT use this configuration in production.',
  )
  return 'dev-secret-change-me'
}

function buildAuth() {
  return betterAuth({
  // Better Auth runs identity ops BEFORE a current_user_id GUC exists, so
  // the RLS-enforced app role would reject INSERTs on `users` / `sessions`
  // / `accounts` (users_self USING clause fails closed). Use the BYPASSRLS
  // migrate role for the identity layer; app code keeps using getDb() +
  // withTenant() for tenant-scoped queries.
  database: drizzleAdapter(getMigrateDb(), {
    provider: 'pg',
    schema,
    usePlural: true,
  }),
  baseURL,
  secret: resolveSecret(),
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
      // Hash the token in the verifications table so a DB reader (backup,
      // psql access, SQLi vector) cannot replay an unexpired sign-in URL.
      // The token in the email URL itself remains a one-time bearer secret.
      storeToken: 'hashed',
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
