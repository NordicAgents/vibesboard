import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
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
  test('request create/get/update round-trip', async () => {
    await withTestDb(async ({ adminDb }) => {
      const code = randomUUID()
      const created = await createDeletionRequest(code, 'meta-1', adminDb)
      assert.equal(created.status, 'pending')
      assert.equal(created.metaUserId, 'meta-1')

      const fetched = await getDeletionRequest(code, adminDb)
      assert.equal(fetched?.confirmationCode, code)

      await updateDeletionRequest(
        code,
        { status: 'completed', deletedAccounts: 2, completedAt: new Date() },
        adminDb,
      )
      const after = await getDeletionRequest(code, adminDb)
      assert.equal(after?.status, 'completed')
      assert.equal(after?.deletedAccounts, 2)
      assert.ok(after?.completedAt)
    })
  })

  test('getDeletionRequest returns null for unknown code', async () => {
    await withTestDb(async ({ adminDb }) => {
      assert.equal(await getDeletionRequest(randomUUID(), adminDb), null)
    })
  })

  test('deleteInstagramDataForMetaUser removes matching accounts and cascades', async () => {
    await withTestDb(async ({ adminDb }) => {
      const { tenantId } = await seedTenant(adminDb)
      const metaUserId = 'meta-xyz'
      const a = await seedInstagramAccount(adminDb, tenantId, metaUserId)
      // An unrelated account for a different meta user must survive.
      const b = await seedInstagramAccount(adminDb, tenantId, 'other-meta')

      const count = await deleteInstagramDataForMetaUser(metaUserId, adminDb)
      assert.equal(count, 1)

      const remainingAccounts = await adminDb
        .select({ id: instagramAccounts.id })
        .from(instagramAccounts)
      assert.deepEqual(
        remainingAccounts.map((r: any) => r.id),
        [b.accountId],
      )

      // Conversation + message of the deleted account cascaded away.
      const convs = await adminDb
        .select({ id: instagramConversations.id })
        .from(instagramConversations)
        .where(eq(instagramConversations.accountId, a.accountId))
      assert.equal(convs.length, 0)
      const msgs = await adminDb
        .select({ id: instagramMessages.id })
        .from(instagramMessages)
        .where(eq(instagramMessages.conversationId, a.convId))
      assert.equal(msgs.length, 0)
    })
  })

  test('returns 0 when no account matches the meta user', async () => {
    await withTestDb(async ({ adminDb }) => {
      assert.equal(
        await deleteInstagramDataForMetaUser('nobody', adminDb),
        0,
      )
    })
  })
})
