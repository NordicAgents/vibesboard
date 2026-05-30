// Playwright global setup.
//
// Creates (idempotently) a deterministic E2E user via the better-auth
// email/password sign-up endpoint — which also auto-provisions a personal
// tenant through the on-user-create hook — marks the email verified directly
// in the DB (the app sets requireEmailVerification: true), then signs in and
// persists the authenticated cookie jar to STORAGE_STATE for reuse.
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import postgres from 'postgres'
import { request, type FullConfig } from '@playwright/test'
import { BASE_URL, E2E_USER, STORAGE_STATE } from './constants.ts'

const MIGRATE_URL =
  process.env.DATABASE_MIGRATE_URL ??
  'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5432/vibesboard_dev'

// better-auth blocks sign-in for unverified emails; flip the flag directly
// (BYPASSRLS migrate role) so the deterministic E2E account can log in.
async function markEmailVerified(email: string) {
  const sql = postgres(MIGRATE_URL, { max: 1, prepare: false })
  try {
    await sql`UPDATE users SET email_verified = true WHERE email = ${email}`
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function ensureUser(ctx: Awaited<ReturnType<typeof request.newContext>>) {
  // Sign-up is idempotent enough for our purposes: a duplicate email returns a
  // 4xx we can ignore, after which sign-in still succeeds.
  const res = await ctx.post('/api/auth/sign-up/email', {
    data: {
      email: E2E_USER.email,
      password: E2E_USER.password,
      name: E2E_USER.name,
    },
    failOnStatusCode: false,
  })
  // 200/201 = created; 4xx with "exists" = already there. Anything else is fatal.
  if (![200, 201, 400, 409, 422].includes(res.status())) {
    throw new Error(
      `sign-up returned unexpected status ${res.status()}: ${await res.text()}`,
    )
  }
}

export default async function globalSetup(_config: FullConfig) {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true })

  const ctx = await request.newContext({ baseURL: BASE_URL })
  try {
    await ensureUser(ctx)
    await markEmailVerified(E2E_USER.email)

    const signIn = await ctx.post('/api/auth/sign-in/email', {
      data: { email: E2E_USER.email, password: E2E_USER.password },
      failOnStatusCode: false,
    })
    if (![200, 201].includes(signIn.status())) {
      throw new Error(
        `sign-in failed (${signIn.status()}): ${await signIn.text()}`,
      )
    }

    // Persist the cookie jar (better-auth.session_token) for authed specs.
    await ctx.storageState({ path: STORAGE_STATE })
  } finally {
    await ctx.dispose()
  }
}
