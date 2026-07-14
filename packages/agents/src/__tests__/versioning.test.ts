import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  agents,
  agentVersions
} from '@vibesboard/adapter-postgres/schema'
import type { Agent } from '@vibesboard/adapter-postgres/schema'
import {
  toAgentConfigSnapshot,
  snapshotsEqual,
  recordAgentVersion,
  restoreAgentVersion,
  listAgentVersions,
  getAgentVersion,
  getAgentCurrentVersion
} from '../versioning.ts'

async function seedAgent(
  adminDb: any,
  overrides: Record<string, unknown> = {}
) {
  const userId = randomUUID()
  const tenantId = randomUUID()
  const agentId = randomUUID()
  await adminDb
    .insert(users)
    .values({ id: userId, email: `o${userId}@a.com`, name: 'Owner' })
  await adminDb.insert(tenants).values({
    id: tenantId,
    name: 'Acme',
    slug: `acme-${tenantId.slice(0, 8)}`,
    createdBy: userId,
    isPersonal: false
  })
  await adminDb.insert(agents).values({
    id: agentId,
    tenantId,
    userId,
    name: 'Support',
    slug: `s-${agentId.slice(0, 8)}`,
    instructions: 'v1 instructions',
    ...overrides
  })
  return { userId, tenantId, agentId }
}

describe('snapshot builder + equality (pure)', () => {
  const baseRow = {
    id: 'x',
    tenantId: 't',
    userId: 'u',
    name: 'A',
    slug: 'a',
    instructions: 'hi',
    mode: 'provider',
    allowAnonymous: false,
    accessPasswordHash: 'SECRET-HASH',
    greetingText: null,
    quickSuggestionsMode: 'off',
    quickSuggestionsCount: 0,
    tools: ['builtin:calc'],
    fileKeys: [],
    handoffTargets: [],
    collectionFields: null,
    maxResponses: null,
    maxAgentResponses: null,
    totalResponseCount: 42,
    googleReviewEnabled: false,
    googlePlaceId: null,
    retrievalStrategy: 'direct',
    lastEmbeddingsSyncAt: new Date(),
    schedulingConfig: null,
    notificationConfig: null,
    bookingConfig: null,
    dataConfig: null,
    calendarAvailabilityConfig: null,
    currentVersion: 3,
    createdAt: new Date(),
    updatedAt: new Date()
  } as unknown as Agent

  it('excludes credential + counters + pointer from the snapshot', () => {
    const snap = toAgentConfigSnapshot(baseRow)
    expect(snap).not.toHaveProperty('accessPasswordHash')
    expect(snap).not.toHaveProperty('totalResponseCount')
    expect(snap).not.toHaveProperty('lastEmbeddingsSyncAt')
    expect(snap).not.toHaveProperty('currentVersion')
    expect(snap).not.toHaveProperty('slug')
    expect(snap.instructions).toBe('hi')
  })

  it('snapshotsEqual is order-insensitive and diff-sensitive', () => {
    const a = toAgentConfigSnapshot(baseRow)
    const b = toAgentConfigSnapshot(baseRow)
    expect(snapshotsEqual(a, b)).toBe(true)
    expect(snapshotsEqual(a, { ...b, instructions: 'changed' })).toBe(false)
    // counter-only change on the row must NOT change the snapshot
    const bumped = toAgentConfigSnapshot({
      ...baseRow,
      totalResponseCount: 99
    } as Agent)
    expect(snapshotsEqual(a, bumped)).toBe(true)
  })

  it('llmConfigId is included in the snapshot', () => {
    const withId = toAgentConfigSnapshot({
      ...baseRow,
      llmConfigId: 'some-uuid-value'
    } as unknown as Agent)
    expect(withId.llmConfigId).toBe('some-uuid-value')

    const withNull = toAgentConfigSnapshot({
      ...baseRow,
      llmConfigId: null
    } as unknown as Agent)
    expect(withNull.llmConfigId).toBeNull()
  })

  it('memoryEnabled is included in the snapshot', () => {
    const enabled = toAgentConfigSnapshot({
      ...baseRow,
      memoryEnabled: true
    } as unknown as Agent)
    expect(enabled.memoryEnabled).toBe(true)

    const disabled = toAgentConfigSnapshot({
      ...baseRow,
      memoryEnabled: false
    } as unknown as Agent)
    expect(disabled.memoryEnabled).toBe(false)
  })

  it('snapshotsEqual is insensitive to key ordering in nested schedulingConfig', () => {
    const schedA = {
      enabled: true,
      calendarConnectionId: null,
      defaultDurationMinutes: 30,
      bufferMinutes: 5,
      timezone: 'UTC',
      availableHours: { start: '09:00', end: '17:00' },
      availableDays: [1, 2, 3, 4, 5],
      meetingTitleTemplate: 'Chat with us',
      createMeetLink: false,
    }
    // Same values as schedA but keys written in a different order
    const schedB = {
      bufferMinutes: 5,
      timezone: 'UTC',
      enabled: true,
      calendarConnectionId: null,
      availableDays: [1, 2, 3, 4, 5],
      defaultDurationMinutes: 30,
      availableHours: { start: '09:00', end: '17:00' },
      meetingTitleTemplate: 'Chat with us',
      createMeetLink: false,
    }
    const base = toAgentConfigSnapshot(baseRow)
    const a = { ...base, schedulingConfig: schedA } as typeof base
    const b = { ...base, schedulingConfig: schedB } as typeof base
    expect(snapshotsEqual(a, b)).toBe(true)
  })
})

describe('agent versioning (postgres)', () => {
  it('create → v1, update → v2, unchanged update → no-op', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId, userId } = await seedAgent(adminDb)

      const v1 = await recordAgentVersion(adminDb, agentId, {
        source: 'create',
        actor: userId
      })
      expect(v1).toEqual({ versionNo: 1, created: true })
      expect(await getAgentCurrentVersion(agentId, adminDb)).toBe(1)

      await adminDb
        .update(agents)
        .set({ instructions: 'v2 instructions' })
        .where(eq(agents.id, agentId))
      const v2 = await recordAgentVersion(adminDb, agentId, {
        source: 'update',
        actor: userId,
        note: 'tweaked prompt'
      })
      expect(v2).toEqual({ versionNo: 2, created: true })
      expect(await getAgentCurrentVersion(agentId, adminDb)).toBe(2)

      // no config change → no new version
      const noop = await recordAgentVersion(adminDb, agentId, {
        source: 'update',
        actor: userId
      })
      expect(noop).toEqual({ versionNo: 2, created: false })
      expect(await getAgentCurrentVersion(agentId, adminDb)).toBe(2)

      const stored = await getAgentVersion(agentId, 2, adminDb)
      expect(stored?.config.instructions).toBe('v2 instructions')
      expect(stored?.changeNote).toBe('tweaked prompt')
    })
  })

  it('restore is forward-only and reverts live config', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId, userId } = await seedAgent(adminDb)
      await recordAgentVersion(adminDb, agentId, { source: 'create', actor: userId })

      await adminDb
        .update(agents)
        .set({ instructions: 'v2 instructions' })
        .where(eq(agents.id, agentId))
      await recordAgentVersion(adminDb, agentId, { source: 'update', actor: userId })

      const result = await restoreAgentVersion(
        agentId,
        1,
        { actor: userId },
        adminDb
      )
      expect(result.versionNo).toBe(3)
      expect(result.snapshot.instructions).toBe('v1 instructions')

      // live row reverted, pointer advanced, history intact
      const [live] = await adminDb
        .select()
        .from(agents)
        .where(eq(agents.id, agentId))
      expect(live.instructions).toBe('v1 instructions')
      expect(live.currentVersion).toBe(3)

      const versions = await listAgentVersions(agentId, {}, adminDb)
      expect(versions.map(v => v.versionNo)).toEqual([3, 2, 1])
      expect(versions[0].source).toBe('restore')
      expect(versions[0].restoredFrom).toBe(1)
    })
  })

  it('concurrent version numbers do not collide (unique index holds)', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { agentId, userId } = await seedAgent(adminDb)
      await recordAgentVersion(adminDb, agentId, { source: 'create', actor: userId })

      // Two versions with the same explicit versionNo must violate the unique index.
      await adminDb.insert(agentVersions).values({
        id: randomUUID(),
        tenantId: (await getAgentVersion(agentId, 1, adminDb))!.tenantId,
        agentId,
        versionNo: 2,
        config: {} as never,
        source: 'update'
      })
      let threw = false
      try {
        await adminDb.insert(agentVersions).values({
          id: randomUUID(),
          tenantId: (await getAgentVersion(agentId, 1, adminDb))!.tenantId,
          agentId,
          versionNo: 2,
          config: {} as never,
          source: 'update'
        })
      } catch {
        threw = true
      }
      expect(threw).toBe(true)
    })
  })

  it('RLS: app role only sees its own tenant versions', async () => {
    await withTestDb(async ({ adminDb, appDb, schemaName }) => {
      const a = await seedAgent(adminDb)
      const b = await seedAgent(adminDb)
      await recordAgentVersion(adminDb, a.agentId, { source: 'create' })
      await recordAgentVersion(adminDb, b.agentId, { source: 'create' })

      const rows = await appDb.transaction(async tx => {
        await tx.execute(sql.raw(`SET search_path TO "${schemaName}", public`))
        await tx.execute(
          sql`SELECT set_config('app.current_tenant_id', ${a.tenantId}, true)`
        )
        await tx.execute(sql`SELECT set_config('app.is_super_admin', 'false', true)`)
        return tx.select().from(agentVersions)
      })
      expect(rows.length).toBe(1)
      expect(rows[0].tenantId).toBe(a.tenantId)
    })
  })
})
