import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users, accounts, sessions } from '@vibesboard/adapter-postgres/schema'
import { handleRiscEvents, RISC_EVENTS } from '../risc.ts'

// adminDb is the BYPASSRLS pool from withTestDb. handleRiscEvents accepts a `db`
// injection seam, so we always pass adminDb to stay inside the per-test schema
// (its internal default getMigrateDb() would otherwise hit the real public schema).
type AdminDb = Parameters<Parameters<typeof withTestDb>[0]>[0]['adminDb']

async function seed(adminDb: AdminDb, sub: string) {
  const userId = randomUUID()
  await adminDb.insert(users).values({ id: userId, email: `u${userId}@a.com`, name: 'U' })
  await adminDb
    .insert(accounts)
    .values({ id: randomUUID(), userId, providerId: 'google', accountId: sub })
  await adminDb
    .insert(sessions)
    .values({ id: randomUUID(), userId, token: randomUUID(), expiresAt: new Date(Date.now() + 1e6) })
  return userId
}

// Build a RISC Security Event Token payload carrying a single event.
const tok = (event: string, sub: string) => ({
  iss: 'https://accounts.google.com',
  aud: 'x',
  iat: 0,
  jti: randomUUID(),
  events: {
    [event]: { subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub } },
  },
})

describe('handleRiscEvents (Better Auth)', () => {
  it('sessions-revoked deletes the user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-1')
      await handleRiscEvents(tok(RISC_EVENTS.SESSIONS_REVOKED, 'sub-1'), adminDb)
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(left.length).toBe(0)
    })
  })

  it('account-disabled sets disabled + revokes sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-2')
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_DISABLED, 'sub-2'), adminDb)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(u.disabled).toBe(true)
      expect(left.length).toBe(0)
    })
  })

  it('account-enabled clears disabled', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-3')
      await adminDb.update(users).set({ disabled: true }).where(eq(users.id, userId))
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_ENABLED, 'sub-3'), adminDb)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      expect(u.disabled).toBe(false)
    })
  })

  it('unknown sub is a no-op (does not throw)', async () => {
    await withTestDb(async ({ adminDb }) => {
      await expect(
        handleRiscEvents(tok(RISC_EVENTS.SESSIONS_REVOKED, 'no-such-sub'), adminDb),
      ).resolves.toBeUndefined()
    })
  })

  it('verification event is a no-op', async () => {
    await withTestDb(async ({ adminDb }) => {
      await expect(
        handleRiscEvents(tok(RISC_EVENTS.VERIFICATION, 'whatever'), adminDb),
      ).resolves.toBeUndefined()
    })
  })

  // --- Expanded coverage of the remaining event branches -------------------

  it('tokens-revoked revokes the user sessions (same effect as sessions-revoked)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-tokens')
      await handleRiscEvents(tok(RISC_EVENTS.TOKENS_REVOKED, 'sub-tokens'), adminDb)
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(left.length).toBe(0)
      // tokens-revoked must NOT disable the account
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      expect(u.disabled).toBe(false)
    })
  })

  it('token-revoked revokes the user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-token')
      await handleRiscEvents(tok(RISC_EVENTS.TOKEN_REVOKED, 'sub-token'), adminDb)
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(left.length).toBe(0)
    })
  })

  it('account-credential-change-required revokes the user sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-cred')
      await handleRiscEvents(
        tok(RISC_EVENTS.ACCOUNT_CREDENTIAL_CHANGE_REQUIRED, 'sub-cred'),
        adminDb,
      )
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(left.length).toBe(0)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      expect(u.disabled).toBe(false)
    })
  })

  it('an unrecognized RISC event type is a no-op and does not touch sessions', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-weird')
      await handleRiscEvents(
        tok('https://schemas.openid.net/secevent/risc/event-type/totally-made-up', 'sub-weird'),
        adminDb,
      )
      // Unknown type hits the default switch branch: user is resolved but no action taken.
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(left.length).toBe(1)
      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      expect(u.disabled).toBe(false)
    })
  })

  it('an event whose subject has no sub is skipped (no throw, sessions untouched)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'sub-present')
      const payload = {
        iss: 'https://accounts.google.com',
        aud: 'x',
        iat: 0,
        jti: randomUUID(),
        // subject present but without a `sub` field -> googleSub is undefined -> skipped
        events: {
          [RISC_EVENTS.SESSIONS_REVOKED]: {
            subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com' },
          },
        },
      } as unknown as Parameters<typeof handleRiscEvents>[0]
      await handleRiscEvents(payload, adminDb)
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(left.length).toBe(1)
    })
  })

  it('processes multiple events in one token, applying each effect', async () => {
    await withTestDb(async ({ adminDb }) => {
      const disabledUser = await seed(adminDb, 'multi-disable')
      const revokedUser = await seed(adminDb, 'multi-revoke')
      const payload = {
        iss: 'https://accounts.google.com',
        aud: 'x',
        iat: 0,
        jti: randomUUID(),
        events: {
          [RISC_EVENTS.ACCOUNT_DISABLED]: {
            subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub: 'multi-disable' },
          },
          [RISC_EVENTS.SESSIONS_REVOKED]: {
            subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub: 'multi-revoke' },
          },
        },
      }
      await handleRiscEvents(payload, adminDb)

      const [disabled] = await adminDb.select().from(users).where(eq(users.id, disabledUser))
      expect(disabled.disabled).toBe(true)
      const disabledSessions = await adminDb
        .select()
        .from(sessions)
        .where(eq(sessions.userId, disabledUser))
      expect(disabledSessions.length).toBe(0)

      const [revoked] = await adminDb.select().from(users).where(eq(users.id, revokedUser))
      expect(revoked.disabled).toBe(false)
      const revokedSessions = await adminDb
        .select()
        .from(sessions)
        .where(eq(sessions.userId, revokedUser))
      expect(revokedSessions.length).toBe(0)
    })
  })

  it('isolation: a RISC event for one user does not affect a different user', async () => {
    await withTestDb(async ({ adminDb }) => {
      const target = await seed(adminDb, 'iso-target')
      const bystander = await seed(adminDb, 'iso-bystander')

      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_DISABLED, 'iso-target'), adminDb)

      const [t] = await adminDb.select().from(users).where(eq(users.id, target))
      expect(t.disabled).toBe(true)
      const targetSessions = await adminDb
        .select()
        .from(sessions)
        .where(eq(sessions.userId, target))
      expect(targetSessions.length).toBe(0)

      // The bystander must remain enabled with their session intact.
      const [b] = await adminDb.select().from(users).where(eq(users.id, bystander))
      expect(b.disabled).toBe(false)
      const bystanderSessions = await adminDb
        .select()
        .from(sessions)
        .where(eq(sessions.userId, bystander))
      expect(bystanderSessions.length).toBe(1)
    })
  })

  it('account-enabled does NOT re-create sessions, only clears the disabled flag', async () => {
    await withTestDb(async ({ adminDb }) => {
      const userId = await seed(adminDb, 'enable-flag')
      // Disable + revoke first.
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_DISABLED, 'enable-flag'), adminDb)
      // Then enable.
      await handleRiscEvents(tok(RISC_EVENTS.ACCOUNT_ENABLED, 'enable-flag'), adminDb)

      const [u] = await adminDb.select().from(users).where(eq(users.id, userId))
      expect(u.disabled).toBe(false)
      const left = await adminDb.select().from(sessions).where(eq(sessions.userId, userId))
      expect(left.length).toBe(0)
    })
  })
})
