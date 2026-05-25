import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { withTestDb } from '@vibesboard/adapter-postgres/test-utils'
import { users } from '@vibesboard/adapter-postgres/schema'
import { isUserDisabled } from '../risc-effects.ts'

describe('isUserDisabled', () => {
  test('true for a disabled user, false otherwise, false for missing', async () => {
    await withTestDb(async ({ adminDb }) => {
      const id = randomUUID()
      await adminDb.insert(users).values({ id, email: `u${id}@a.com`, name: 'U', disabled: true })
      assert.equal(await isUserDisabled(id, adminDb), true)
      await adminDb.update(users).set({ disabled: false }).where(eq(users.id, id))
      assert.equal(await isUserDisabled(id, adminDb), false)
      assert.equal(await isUserDisabled(randomUUID(), adminDb), false)
    })
  })
})
