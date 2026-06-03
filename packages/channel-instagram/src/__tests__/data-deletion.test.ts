import { describe, it, expect } from 'vitest'
import { randomUUID } from 'node:crypto'
import { uuidv7 } from 'uuidv7'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import {
  users,
  tenants,
  instagramAccounts,
  instagramConversations,
  instagramMessages,
} from '@vibesboard/adapter-postgres/schema'
import {
  createDeletionRequest,
  getDeletionRequest,
  updateDeletionRequest,
  deleteInstagramDataForMetaUser,
} from '../data-deletion.ts'

async function seedTenant(adminDb: any) {
  const u = randomUUID(),
    t = randomUUID()
  await adminDb.insert(users).values({ id: u, email: `o${u}@a.com`, name: 'O' })
  await adminDb.insert(tenants).values({
    id: t,
    name: 'Acme',
    slug: `acme-${t.slice(0, 8)}`,
    createdBy: u,
    isPersonal: false,
  })
  return { tenantId: t }
}

async function seedInstagramAccount(
  adminDb: any,
  tenantId: string,
  metaUserId: string | null,
) {
  const accountId = uuidv7()
  await adminDb.insert(instagramAccounts).values({
    id: accountId,
    tenantId,
    instagramAccountId: `ig-${accountId.slice(0, 8)}`,
    pageId: 'p1',
    pageName: 'Page',
    instagramUsername: 'biz',
    accessTokenEncrypted: 'enc',
    metaUserId,
  })
  const convId = uuidv7()
  await adminDb.insert(instagramConversations).values({
    id: convId,
    tenantId,
    accountId,
    contactIgsid: `c-${convId.slice(0, 8)}`,
    windowExpiresAt: new Date(Date.now() + 86400000),
  })
  await adminDb.insert(instagramMessages).values({
    id: uuidv7(),
    tenantId,
    conversationId: convId,
    igMessageId: `m-${randomUUID()}`,
    fromAddr: 'a',
    toAddr: 'b',
    type: 'text',
    text: 'hi',
    direction: 'inbound',
    status: 'received',
    timestampOriginal: new Date(),
  })
  return { accountId, convId }
}

describe('meta data deletion (postgres)', () => {
  it('request create/get/update round-trip', async () => {
    await withTestDb(async ({ adminDb }) => {
      const code = randomUUID()
      const created = await createDeletionRequest(code, 'meta-1', adminDb)
      expect(created.status).toBe('pending')
      expect(created.metaUserId).toBe('meta-1')
      expect(created.deletedAccounts).toBe(0)

      const fetched = await getDeletionRequest(code, adminDb)
      expect(fetched?.confirmationCode).toBe(code)

      await updateDeletionRequest(
        code,
        { status: 'completed', deletedAccounts: 2, completedAt: new Date() },
        adminDb,
      )
      const after = await getDeletionRequest(code, adminDb)
      expect(after?.status).toBe('completed')
      expect(after?.deletedAccounts).toBe(2)
      expect(after?.completedAt).toBeTruthy()
    })
  })

  it('updateDeletionRequest can record a failure with an error message', async () => {
    await withTestDb(async ({ adminDb }) => {
      const code = randomUUID()
      await createDeletionRequest(code, 'meta-fail', adminDb)
      await updateDeletionRequest(
        code,
        { status: 'failed', error: 'boom' },
        adminDb,
      )
      const after = await getDeletionRequest(code, adminDb)
      expect(after?.status).toBe('failed')
      expect(after?.error).toBe('boom')
      // deletedAccounts untouched (defaults to 0).
      expect(after?.deletedAccounts).toBe(0)
    })
  })

  it('updateDeletionRequest only patches provided fields', async () => {
    await withTestDb(async ({ adminDb }) => {
      const code = randomUUID()
      await createDeletionRequest(code, 'meta-partial', adminDb)
      await updateDeletionRequest(code, { deletedAccounts: 5 }, adminDb)
      const after = await getDeletionRequest(code, adminDb)
      // status stays pending; only deletedAccounts changed.
      expect(after?.status).toBe('pending')
      expect(after?.deletedAccounts).toBe(5)
      expect(after?.completedAt).toBe(null)
    })
  })

  it('updateDeletionRequest can clear the error back to null', async () => {
    await withTestDb(async ({ adminDb }) => {
      const code = randomUUID()
      await createDeletionRequest(code, 'meta-clear', adminDb)
      await updateDeletionRequest(code, { error: 'temporary' }, adminDb)
      expect((await getDeletionRequest(code, adminDb))?.error).toBe('temporary')
      await updateDeletionRequest(code, { error: null }, adminDb)
      expect((await getDeletionRequest(code, adminDb))?.error).toBe(null)
    })
  })

  it('getDeletionRequest returns null for unknown code', async () => {
    await withTestDb(async ({ adminDb }) => {
      expect(await getDeletionRequest(randomUUID(), adminDb)).toBe(null)
    })
  })

  it('deleteInstagramDataForMetaUser removes matching accounts and cascades', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      const metaUserId = 'meta-xyz'
      const a = await seedInstagramAccount(adminDb, tenantId, metaUserId)
      // An unrelated account for a different meta user must survive.
      const b = await seedInstagramAccount(adminDb, tenantId, 'other-meta')

      const count = await deleteInstagramDataForMetaUser(metaUserId, adminDb)
      expect(count).toBe(1)

      const remainingAccounts = await adminDb
        .select({ id: instagramAccounts.id })
        .from(instagramAccounts)
      expect(remainingAccounts.map((r: any) => r.id)).toEqual([b.accountId])

      // Conversation + message of the deleted account cascaded away.
      const convs = await adminDb
        .select({ id: instagramConversations.id })
        .from(instagramConversations)
        .where(eq(instagramConversations.accountId, a.accountId))
      expect(convs.length).toBe(0)
      const msgs = await adminDb
        .select({ id: instagramMessages.id })
        .from(instagramMessages)
        .where(eq(instagramMessages.conversationId, a.convId))
      expect(msgs.length).toBe(0)
    })
  })

  it('deleteInstagramDataForMetaUser deletes across tenants for the same meta user', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId: t1 } = await seedTenant(adminDb)
      const { tenantId: t2 } = await seedTenant(adminDb)
      const metaUserId = 'meta-multi'
      await seedInstagramAccount(adminDb, t1, metaUserId)
      await seedInstagramAccount(adminDb, t2, metaUserId)
      // Survivor in t1 owned by a different meta user.
      const survivor = await seedInstagramAccount(adminDb, t1, 'someone-else')

      const count = await deleteInstagramDataForMetaUser(metaUserId, adminDb)
      expect(count).toBe(2)

      const remaining = await adminDb
        .select({ id: instagramAccounts.id })
        .from(instagramAccounts)
      expect(remaining.map((r: any) => r.id)).toEqual([survivor.accountId])
    })
  })

  it('returns 0 when no account matches the meta user', async () => {
    await withTestDb(async ({ adminDb }) => {
      expect(await deleteInstagramDataForMetaUser('nobody', adminDb)).toBe(0)
    })
  })

  it('does not match accounts with a null meta_user_id', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      const kept = await seedInstagramAccount(adminDb, tenantId, null)
      // Deleting by any meta user id leaves the null-owned account intact.
      expect(await deleteInstagramDataForMetaUser('anything', adminDb)).toBe(0)
      const remaining = await adminDb
        .select({ id: instagramAccounts.id })
        .from(instagramAccounts)
      expect(remaining.map((r: any) => r.id)).toEqual([kept.accountId])
    })
  })
})
