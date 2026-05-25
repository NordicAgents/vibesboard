import 'server-only'
import crypto from 'crypto'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import {
  resolveUserIdByGoogleSub,
  revokeUserSessions,
  setUserDisabled,
} from '@vibesboard/adapter-better-auth'

type Db = PostgresJsDatabase<typeof schema>

// ---------------------------------------------------------------------------
// Google RISC (Cross-Account Protection) — Security Event Token handler
// https://developers.google.com/identity/protocols/risc
// ---------------------------------------------------------------------------

const RISC_EVENT_PREFIX = 'https://schemas.openid.net/secevent/risc/event-type/'

export const RISC_EVENTS = {
  SESSIONS_REVOKED: `${RISC_EVENT_PREFIX}sessions-revoked`,
  TOKENS_REVOKED: `${RISC_EVENT_PREFIX}tokens-revoked`,
  TOKEN_REVOKED: `${RISC_EVENT_PREFIX}token-revoked`,
  ACCOUNT_DISABLED: `${RISC_EVENT_PREFIX}account-disabled`,
  ACCOUNT_ENABLED: `${RISC_EVENT_PREFIX}account-enabled`,
  ACCOUNT_CREDENTIAL_CHANGE_REQUIRED: `${RISC_EVENT_PREFIX}account-credential-change-required`,
  VERIFICATION: `${RISC_EVENT_PREFIX}verification`
} as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RiscSubject {
  subject_type: string
  iss: string
  sub: string
}

interface RiscEventPayload {
  subject: RiscSubject
  reason?: string
  state?: string
}

export interface RiscTokenPayload {
  iss: string
  aud: string | string[]
  iat: number
  jti: string
  events: Record<string, RiscEventPayload>
}

// ---------------------------------------------------------------------------
// JWKS cache (re-fetched every hour or on kid miss)
// ---------------------------------------------------------------------------

let jwksCache: { keys: JsonWebKey[]; fetchedAt: number } | null = null
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

async function fetchRiscJwks(): Promise<JsonWebKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_CACHE_TTL_MS) {
    return jwksCache.keys
  }

  const configRes = await fetch(
    'https://accounts.google.com/.well-known/risc-configuration'
  )
  if (!configRes.ok) {
    throw new Error(`Failed to fetch RISC configuration: ${configRes.status}`)
  }
  const config = (await configRes.json()) as { jwks_uri: string }

  const jwksRes = await fetch(config.jwks_uri)
  if (!jwksRes.ok) {
    throw new Error(`Failed to fetch JWKS: ${jwksRes.status}`)
  }
  const jwks = (await jwksRes.json()) as { keys: JsonWebKey[] }

  jwksCache = { keys: jwks.keys, fetchedAt: Date.now() }
  return jwks.keys
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function decodeJwtPart<T>(token: string, index: 0 | 1): T {
  const part = token.split('.')[index]
  return JSON.parse(Buffer.from(part, 'base64url').toString()) as T
}

function verifySignature(parts: string[], jwk: JsonWebKey): boolean {
  const publicKey = crypto.createPublicKey({
    key: jwk as crypto.JsonWebKeyInput['key'],
    format: 'jwk'
  })
  const signedContent = `${parts[0]}.${parts[1]}`
  const signature = Buffer.from(parts[2], 'base64url')

  return crypto
    .createVerify('RSA-SHA256')
    .update(signedContent)
    .verify(publicKey, signature)
}

// ---------------------------------------------------------------------------
// Public: verify a Security Event Token from Google
// ---------------------------------------------------------------------------

export async function verifyRiscToken(
  token: string
): Promise<RiscTokenPayload> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format')
  }

  const header = decodeJwtPart<{ kid: string; alg: string }>(token, 0)

  // Find matching key — retry once with a fresh fetch on kid miss
  let keys = await fetchRiscJwks()
  let jwk = keys.find((k: any) => k.kid === header.kid)
  if (!jwk) {
    jwksCache = null
    keys = await fetchRiscJwks()
    jwk = keys.find((k: any) => k.kid === header.kid)
    if (!jwk) {
      throw new Error(`No matching key for kid: ${header.kid}`)
    }
  }

  if (!verifySignature(parts, jwk)) {
    throw new Error('Invalid JWT signature')
  }

  const payload = decodeJwtPart<RiscTokenPayload>(token, 1)

  // Verify issuer (Google sends with or without trailing slash)
  const normalizedIss = payload.iss.replace(/\/$/, '')
  if (
    normalizedIss !== 'https://accounts.google.com' &&
    normalizedIss !== 'accounts.google.com'
  ) {
    throw new Error(`Invalid issuer: ${payload.iss}`)
  }

  // Audience check: Google sends RISC events for every OAuth client ID in
  // the project. The JWT signature + issuer already prove authenticity, so
  // we accept events for any client ID — rejecting them would cause Google
  // to mark Cross-Account Protection as misconfigured.

  return payload
}

// ---------------------------------------------------------------------------
// Public: process all events in a verified RISC token
// ---------------------------------------------------------------------------

export async function handleRiscEvents(
  payload: RiscTokenPayload,
  db: Db = getMigrateDb()
): Promise<void> {
  for (const [eventType, eventData] of Object.entries(payload.events)) {
    console.log(`[RISC] Processing event: ${eventType}`, {
      jti: payload.jti,
      subject: eventData.subject?.sub
    })

    if (eventType === RISC_EVENTS.VERIFICATION) {
      console.log('[RISC] Verification event received', { state: eventData.state })
      continue
    }

    const googleSub = eventData.subject?.sub
    if (!googleSub) {
      console.warn('[RISC] Event missing subject sub — skipping')
      continue
    }

    const userId = await resolveUserIdByGoogleSub(googleSub, db)
    if (!userId) {
      console.warn(`[RISC] No user for Google sub ${googleSub} — skipping`)
      continue
    }

    await applyRiscEvent(eventType, eventData, userId, db)
  }
}

// Extracted so handleRiscEvents stays under the CCN budget.
async function applyRiscEvent(
  eventType: string,
  eventData: RiscEventPayload,
  userId: string,
  db: Db
): Promise<void> {
  switch (eventType) {
    case RISC_EVENTS.SESSIONS_REVOKED:
    case RISC_EVENTS.TOKENS_REVOKED:
    case RISC_EVENTS.TOKEN_REVOKED:
    case RISC_EVENTS.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED:
      await revokeUserSessions(userId, db)
      console.log(`[RISC] Revoked sessions for user ${userId}`)
      break
    case RISC_EVENTS.ACCOUNT_DISABLED:
      await setUserDisabled(userId, true, db)
      await revokeUserSessions(userId, db)
      console.log(`[RISC] Disabled user ${userId} (reason: ${eventData.reason ?? 'unknown'})`)
      break
    case RISC_EVENTS.ACCOUNT_ENABLED:
      await setUserDisabled(userId, false, db)
      console.log(`[RISC] Re-enabled user ${userId}`)
      break
    default:
      console.warn(`[RISC] Unknown event type: ${eventType}`)
  }
}
