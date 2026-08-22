import { describe, it, expect } from 'vitest'
import { withTenant, getContext, type TenantContext } from '../tenant-context.ts'

describe('tenant-context', () => {
  it('getContext returns undefined outside withTenant', () => {
    expect(getContext()).toBe(undefined)
  })

  it('withTenant exposes context inside the callback', async () => {
    const ctx: TenantContext = {
      tenantId: '11111111-1111-1111-1111-111111111111',
      userId: '22222222-2222-2222-2222-222222222222',
      isSuperAdmin: false,
    }
    await withTenant(ctx, async () => {
      expect(getContext()).toEqual(ctx)
    })
  })

  it('context propagates across awaits', async () => {
    const ctx: TenantContext = {
      tenantId: '11111111-1111-1111-1111-111111111111',
      userId: null,
      isSuperAdmin: false,
    }
    await withTenant(ctx, async () => {
      await new Promise((r) => setTimeout(r, 5))
      expect(getContext()).toEqual(ctx)
    })
  })

  it('nested withTenant overrides the outer context, restores on exit', async () => {
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
      expect(getContext()?.tenantId).toBe(outer.tenantId)
      await withTenant(inner, async () => {
        expect(getContext()?.tenantId).toBe(inner.tenantId)
        expect(getContext()?.isSuperAdmin).toBe(true)
      })
      expect(getContext()?.tenantId).toBe(outer.tenantId)
      expect(getContext()?.isSuperAdmin).toBe(false)
    })
  })

  it('parallel withTenant calls keep contexts isolated', async () => {
    const a: TenantContext = {
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      userId: null,
      isSuperAdmin: false,
    }
    const b: TenantContext = {
      tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      userId: null,
      isSuperAdmin: false,
    }

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
    expect(results[0]).toBe(a.tenantId)
    expect(results[1]).toBe(b.tenantId)
  })

  it('returns the value of fn', async () => {
    const v = await withTenant(
      {
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        userId: null,
        isSuperAdmin: false,
      },
      async () => 42,
    )
    expect(v).toBe(42)
  })

  // ── Added coverage ─────────────────────────────────────────────────────

  it('context does not leak after withTenant resolves', async () => {
    await withTenant(
      { tenantId: 'leak-test', userId: null, isSuperAdmin: false },
      async () => getContext(),
    )
    expect(getContext()).toBe(undefined)
  })

  it('context is cleared even when fn throws', async () => {
    await expect(
      withTenant(
        { tenantId: 'throw-test', userId: null, isSuperAdmin: false },
        async () => {
          throw new Error('boom')
        },
      ),
    ).rejects.toThrow(/boom/)
    expect(getContext()).toBe(undefined)
  })

  it('preserves the full context shape including userId and isSuperAdmin', async () => {
    const ctx: TenantContext = {
      tenantId: 't-1',
      userId: 'u-1',
      isSuperAdmin: true,
    }
    const seen = await withTenant(ctx, async () => getContext())
    expect(seen).toEqual(ctx)
    expect(seen?.userId).toBe('u-1')
    expect(seen?.isSuperAdmin).toBe(true)
  })

  it('a sibling async task with no context observes undefined while another holds context', async () => {
    const withCtx = withTenant(
      { tenantId: 'has-ctx', userId: null, isSuperAdmin: false },
      async () => {
        await new Promise((r) => setTimeout(r, 5))
        return getContext()?.tenantId
      },
    )
    const withoutCtx = (async () => {
      await new Promise((r) => setTimeout(r, 2))
      return getContext()
    })()
    const [a, b] = await Promise.all([withCtx, withoutCtx])
    expect(a).toBe('has-ctx')
    expect(b).toBe(undefined)
  })

  it('a non-async fn return value is propagated (sync return inside async wrapper)', async () => {
    const v = await withTenant(
      { tenantId: 't', userId: null, isSuperAdmin: false },
      // eslint-disable-next-line @typescript-eslint/require-await
      async () => 'sync-ish',
    )
    expect(v).toBe('sync-ish')
  })
})
