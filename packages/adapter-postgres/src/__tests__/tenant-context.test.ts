import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { withTenant, getContext, type TenantContext } from '../tenant-context.ts'

describe('tenant-context', () => {
  test('getContext returns undefined outside withTenant', () => {
    assert.equal(getContext(), undefined)
  })

  test('withTenant exposes context inside the callback', async () => {
    const ctx: TenantContext = {
      tenantId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      isSuperAdmin: false,
    }
    await withTenant(ctx, async () => {
      assert.deepEqual(getContext(), ctx)
    })
  })

  test('context propagates across awaits', async () => {
    const ctx: TenantContext = {
      tenantId: '11111111-1111-1111-1111-111111111111',
      userId: null,
      isSuperAdmin: false,
    }
    await withTenant(ctx, async () => {
      await new Promise((r) => setTimeout(r, 5))
      assert.deepEqual(getContext(), ctx)
    })
  })

  test('nested withTenant overrides the outer context, restores on exit', async () => {
    const outer: TenantContext = {
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      userId: null,
      isSuperAdmin: false,
    }
    const inner: TenantContext = {
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: null,
      isSuperAdmin: true,
    }
    await withTenant(outer, async () => {
      assert.equal(getContext()?.tenantId, outer.tenantId)
      await withTenant(inner, async () => {
        assert.equal(getContext()?.tenantId, inner.tenantId)
        assert.equal(getContext()?.isSuperAdmin, true)
      })
      assert.equal(getContext()?.tenantId, outer.tenantId)
      assert.equal(getContext()?.isSuperAdmin, false)
    })
  })

  test('parallel withTenant calls keep contexts isolated', async () => {
    const a: TenantContext = { tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', userId: null, isSuperAdmin: false }
    const b: TenantContext = { tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', userId: null, isSuperAdmin: false }

    const results = await Promise.all([
      withTenant(a, async () => {
        await new Promise((r) => setTimeout(r, 10))
        return getContext()?.tenantId
      }),
      withTenant(b, async () => {
        await new Promise((r) => setTimeout(r, 5))
        return getContext()?.tenantId
      }),
    ])
    assert.equal(results[0], a.tenantId)
    assert.equal(results[1], b.tenantId)
  })

  test('returns the value of fn', async () => {
    const v = await withTenant(
      { tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', userId: null, isSuperAdmin: false },
      async () => 42,
    )
    assert.equal(v, 42)
  })
})
