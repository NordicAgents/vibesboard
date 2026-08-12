/**
 * Local global setup — mirrors global-setup.ts but targets port 5434
 * (the local Postgres container; 5432/5433 are SSH-tunnelled on this machine).
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import postgres from 'postgres'
import { request, type FullConfig } from '@playwright/test'
import {
  BASE_URL,
  E2E_OUTSIDER,
  E2E_USER,
  OUTSIDER_STATE,
  STORAGE_STATE,
} from '../constants.ts'

// Override: local Postgres lives on 5434
const MIGRATE_URL =
  process.env.DATABASE_MIGRATE_URL ??
  'postgres://vibesboard_migrate:vibesboard_migrate@localhost:5434/vibesboard_dev'

// Override: test server on 3100
const LOCAL_BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3100'

async function markEmailVerified(email: string) {
  const sql = postgres(MIGRATE_URL, { max: 1, prepare: false })
  try {
    await sql`UPDATE users SET email_verified = true WHERE email = ${email}`
  } finally {
    await sql.end({ timeout: 1 })
  }
}

async function ensureUser(ctx: Awaited<ReturnType<typeof request.newContext>>) {
  const res = await ctx.post('/api/auth/sign-up/email', {
    data: { email: E2E_USER.email, password: E2E_USER.password, name: E2E_USER.name },
    failOnStatusCode: false,
  })
  if (![200, 201, 400, 409, 422].includes(res.status())) {
    throw new Error(`sign-up returned unexpected status ${res.status()}: ${await res.text()}`)
  }
}

const ADMIN_EMAIL = 'superadmin@vibesboard.local'
const ADMIN_PASS = 'SuperAdmin123!'
const ADMIN_STATE = 'e2e/.auth/admin.json'

async function cleanupE2EWorkspaces(sql: ReturnType<typeof postgres>) {
  // Remove old E2E team workspaces to stay under MAX_TEAM_WORKSPACES (5)
  await sql`
    DELETE FROM tenants
    WHERE slug LIKE 'e2e-team-%'
       OR slug LIKE 'e2e-extra-team-%'
       OR slug LIKE 'e2e-collision-%'
       OR slug LIKE 'e2e-admin-tenant-%'
  `
}

/**
 * The LLM-provider specs create configs on the *personal* tenant, which
 * cleanupE2EWorkspaces deliberately never deletes. Without this, rows pile up
 * run after run and later assertions can be satisfied by a leftover from an
 * earlier run instead of the provider the test just created.
 */
async function cleanupE2ELlmConfigs(sql: ReturnType<typeof postgres>) {
  await sql`DELETE FROM tenant_llm_configs WHERE label LIKE 'E2E %'`
}

/**
 * Promote the superadmin account. This runs AFTER the better-auth sign-up so
 * the user is created through the normal flow — inserting the users row
 * directly would leave it without a credential account (breaking sign-in) and
 * skip the on-user-create hook that provisions the personal tenant.
 */
async function promoteSuperAdmin(sql: ReturnType<typeof postgres>) {
  await sql`
    UPDATE users
    SET is_super_admin = true, email_verified = true
    WHERE email = ${ADMIN_EMAIL}
  `
}

export default async function localGlobalSetup(_config: FullConfig) {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true })

  // ── Regular E2E user ───────────────────────────────────────────────────────
  const ctx = await request.newContext({ baseURL: LOCAL_BASE_URL })
  try {
    await ensureUser(ctx)
    await markEmailVerified(E2E_USER.email)

    const signIn = await ctx.post('/api/auth/sign-in/email', {
      data: { email: E2E_USER.email, password: E2E_USER.password },
      failOnStatusCode: false,
    })
    if (![200, 201].includes(signIn.status())) {
      throw new Error(`sign-in failed (${signIn.status()}): ${await signIn.text()}`)
    }

    await ctx.storageState({ path: STORAGE_STATE })
    console.log(`[local-setup] authenticated as ${E2E_USER.email} → ${STORAGE_STATE}`)
  } finally {
    await ctx.dispose()
  }

  // ── Outsider user (tenant-isolation fixture) ───────────────────────────────
  // Signing up provisions its own personal tenant via the on-user-create hook,
  // so this account is a member of nothing the E2E_USER owns.
  const outsiderCtx = await request.newContext({ baseURL: LOCAL_BASE_URL })
  try {
    const signUp = await outsiderCtx.post('/api/auth/sign-up/email', {
      data: {
        email: E2E_OUTSIDER.email,
        password: E2E_OUTSIDER.password,
        name: E2E_OUTSIDER.name,
      },
      failOnStatusCode: false,
    })
    if (![200, 201, 400, 409, 422].includes(signUp.status())) {
      throw new Error(
        `outsider sign-up returned unexpected status ${signUp.status()}: ${await signUp.text()}`,
      )
    }
    await markEmailVerified(E2E_OUTSIDER.email)

    const signIn = await outsiderCtx.post('/api/auth/sign-in/email', {
      data: { email: E2E_OUTSIDER.email, password: E2E_OUTSIDER.password },
      failOnStatusCode: false,
    })
    if (![200, 201].includes(signIn.status())) {
      throw new Error(
        `outsider sign-in failed (${signIn.status()}): ${await signIn.text()}`,
      )
    }

    mkdirSync(dirname(OUTSIDER_STATE), { recursive: true })
    await outsiderCtx.storageState({ path: OUTSIDER_STATE })
    console.log(`[local-setup] authenticated as ${E2E_OUTSIDER.email} → ${OUTSIDER_STATE}`)
  } finally {
    await outsiderCtx.dispose()
  }

  // ── Superadmin user ────────────────────────────────────────────────────────
  const sql = postgres(MIGRATE_URL, { max: 1, prepare: false })
  try {
    await cleanupE2EWorkspaces(sql)
    await cleanupE2ELlmConfigs(sql)
  } finally {
    await sql.end({ timeout: 1 })
  }

  const adminCtx = await request.newContext({ baseURL: LOCAL_BASE_URL })
  try {
    // Create the account through better-auth (idempotent — a duplicate email
    // returns a 4xx we ignore), then promote it.
    await adminCtx.post('/api/auth/sign-up/email', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASS, name: 'E2E SuperAdmin' },
      failOnStatusCode: false,
    })

    const adminSql = postgres(MIGRATE_URL, { max: 1, prepare: false })
    try {
      await promoteSuperAdmin(adminSql)
    } finally {
      await adminSql.end({ timeout: 1 })
    }

    const adminSignIn = await adminCtx.post('/api/auth/sign-in/email', {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
      failOnStatusCode: false,
      headers: { Origin: LOCAL_BASE_URL },
    })
    if (![200, 201].includes(adminSignIn.status())) {
      throw new Error(`superadmin sign-in failed (${adminSignIn.status()}): ${await adminSignIn.text()}`)
    }

    mkdirSync(dirname(ADMIN_STATE), { recursive: true })
    await adminCtx.storageState({ path: ADMIN_STATE })
    console.log(`[local-setup] authenticated as ${ADMIN_EMAIL} → ${ADMIN_STATE}`)
  } finally {
    await adminCtx.dispose()
  }

  await warmHeavyRoutes()
}

/**
 * Compile the expensive routes before any test runs.
 *
 * The suite runs against `next dev`, which compiles each route on first hit.
 * /api/smoke and the agent-creator routes pull in the whole @vibesboard/ai
 * runtime (drizzle, pdf-parse, mammoth, exceljs, jsdom), and on a 2-core CI
 * runner that first compile can outlast the 90s per-test timeout — the test
 * fails having measured Turbopack rather than the app. 00-smoke.spec.ts
 * already works around this for /agents with test.slow().
 *
 * Paying it once here keeps the cost out of every individual test budget.
 * Best-effort: a route that errors or times out is left to its test to
 * report, so warming can never turn a real failure into a setup crash.
 */
async function warmHeavyRoutes() {
  const ROUTES = ['/forgot-password', '/agents/create-chat', '/api/smoke?mode=file']
  const ctx = await request.newContext({
    baseURL: LOCAL_BASE_URL,
    timeout: 240_000,
    storageState: STORAGE_STATE,
  })
  try {
    for (const route of ROUTES) {
      const started = Date.now()
      try {
        const res = await ctx.get(route, { failOnStatusCode: false })
        console.log(`[local-setup] warmed ${route} -> ${res.status()} in ${Date.now() - started}ms`)
      } catch (err) {
        console.warn(`[local-setup] warming ${route} failed after ${Date.now() - started}ms:`, err)
      }
    }
  } finally {
    await ctx.dispose()
  }
}
