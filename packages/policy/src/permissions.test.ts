import { describe, expect, it } from 'vitest'

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
  it('returns true when count > 0 (multi-row safe)', async () => {
    const client = makeClient({ count: 2, error: null })
    const isAdmin = await isSuperAdminWithClient(client, 'user-1')
    expect(isAdmin).toBe(true)
  })

  it('returns false when count is 0', async () => {
    const client = makeClient({ count: 0, error: null })
    const isAdmin = await isSuperAdminWithClient(client, 'user-1')
    expect(isAdmin).toBe(false)
  })

  it('returns false on error', async () => {
    const client = makeClient({ count: null, error: new Error('fail') })
    const isAdmin = await isSuperAdminWithClient(client, 'user-1')
    expect(isAdmin).toBe(false)
  })
})
