import { test, describe } from 'node:test'
import assert from 'node:assert'

import { isSuperAdminWithClient } from './permissions-core.ts'

const makeClient = (result: any) => {
  const query: any = {
    select: () => query,
    eq: () => query,
    then: (resolve: any, reject: any) =>
      Promise.resolve(result).then(resolve, reject)
  }
  return {
    from: () => query
  } as any
}

describe('isSuperAdminWithClient', () => {
  test('returns true when count > 0 (multi-row safe)', async () => {
    const client = makeClient({ count: 2, error: null })
    const isAdmin = await isSuperAdminWithClient(client, 'user-1')
    assert.strictEqual(isAdmin, true)
  })

  test('returns false when count is 0', async () => {
    const client = makeClient({ count: 0, error: null })
    const isAdmin = await isSuperAdminWithClient(client, 'user-1')
    assert.strictEqual(isAdmin, false)
  })

  test('returns false on error', async () => {
    const client = makeClient({ count: null, error: new Error('fail') })
    const isAdmin = await isSuperAdminWithClient(client, 'user-1')
    assert.strictEqual(isAdmin, false)
  })
})
