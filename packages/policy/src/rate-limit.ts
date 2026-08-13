import 'server-only'

import { createHmac } from 'node:crypto'
import { lt, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { getMigrateDb } from '@vibesboard/adapter-postgres/client'
import * as schema from '@vibesboard/adapter-postgres/schema'
import { requestRateLimits } from '@vibesboard/adapter-postgres/schema'

type Db = PostgresJsDatabase<typeof schema>

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: Date
}

export interface ConsumeRateLimitOptions {
  scope: string
  identifier: string
  salt: string
  limit: number
  windowMs: number
  now?: Date
  db?: Db
}

/**
 * Google Cloud load balancers append client and load-balancer addresses to any
 * incoming X-Forwarded-For value. Reading the second-to-last value prevents a
 * caller-controlled prefix from bypassing throttling. A single value supports
 * local/reverse-proxy deployments that replace rather than append the header.
 */
export function getTrustedClientAddress(headers: Headers): string | null {
  const cloudflareAddress = headers.get('cf-connecting-ip')?.trim()
  if (cloudflareAddress) return cloudflareAddress

  const forwarded = headers
    .get('x-forwarded-for')
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean)

  if (forwarded?.length) {
    return forwarded.length >= 2
      ? forwarded[forwarded.length - 2]
      : forwarded[0]
  }

  return headers.get('x-real-ip')?.trim() || null
}

function hashIdentifier(scope: string, identifier: string, salt: string) {
  return createHmac('sha256', salt)
    .update(scope)
    .update('\0')
    .update(identifier)
    .digest('hex')
}

export function getRateLimitSalt(): string {
  const salt = process.env.RATE_LIMIT_SALT ?? process.env.ENCRYPTION_KEY
  if (salt && salt.length >= 32) return salt
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'RATE_LIMIT_SALT (or ENCRYPTION_KEY fallback) must contain at least 32 characters'
    )
  }
  return 'vibesboard-development-rate-limit-salt'
}

/** Atomically consume one request from a fixed-window Postgres counter. */
export async function consumeRateLimit(
  options: ConsumeRateLimitOptions
): Promise<RateLimitResult> {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new Error('Rate-limit limit must be a positive integer')
  }
  if (!Number.isInteger(options.windowMs) || options.windowMs < 1_000) {
    throw new Error('Rate-limit window must be at least one second')
  }
  if (options.salt.length < 32) {
    throw new Error('Rate-limit salt must contain at least 32 characters')
  }

  const db = options.db ?? getMigrateDb()
  const now = options.now ?? new Date()
  const windowStartMs =
    Math.floor(now.getTime() / options.windowMs) * options.windowMs
  const windowStart = new Date(windowStartMs)
  const resetAt = new Date(windowStartMs + options.windowMs)
  const keyHash = hashIdentifier(
    options.scope,
    options.identifier,
    options.salt
  )

  const [counter] = await db
    .insert(requestRateLimits)
    .values({
      scope: options.scope,
      keyHash,
      windowStart,
      requestCount: 1
    })
    .onConflictDoUpdate({
      target: [
        requestRateLimits.scope,
        requestRateLimits.keyHash,
        requestRateLimits.windowStart
      ],
      set: {
        requestCount: sql`${requestRateLimits.requestCount} + 1`,
        updatedAt: sql`now()`
      }
    })
    .returning({ requestCount: requestRateLimits.requestCount })

  // Deterministic, low-frequency cleanup prevents unbounded table growth
  // without adding a cleanup query to every public request.
  if (keyHash.endsWith('00')) {
    const retentionMs = Math.max(24 * 60 * 60_000, options.windowMs * 2)
    await db
      .delete(requestRateLimits)
      .where(lt(requestRateLimits.windowStart, new Date(now.getTime() - retentionMs)))
  }

  const count = counter?.requestCount ?? options.limit + 1
  return {
    allowed: count <= options.limit,
    limit: options.limit,
    remaining: Math.max(0, options.limit - count),
    resetAt
  }
}
