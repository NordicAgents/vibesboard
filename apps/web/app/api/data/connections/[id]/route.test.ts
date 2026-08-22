import { beforeEach, describe, expect, it, vi } from 'vitest'

let isAdmin = false
vi.mock('@/lib/auth/route-handler', () => ({
  requireAuth: async () => ({
    ok: true as const,
    user: { id: 'member-1', email: 'member@example.test', name: null }
  }),
  requireTenantAdmin: async () =>
    isAdmin
      ? {
          ok: true as const,
          user: { id: 'admin-1', email: 'admin@example.test', name: null },
          role: 'TENANT_ADMIN'
        }
      : {
          ok: false as const,
          response: new Response('Forbidden', { status: 403 })
        }
}))
vi.mock('@/lib/tenant-context', () => ({
  getActiveTenant: async () => 'tenant-1'
}))
vi.mock('@vibesboard/policy/features', () => ({
  isFeatureEnabled: async () => true
}))

const deleteDataConnectionMock = vi.fn(async (..._args: unknown[]) => undefined)
const updateDataConnectionMock = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('@vibesboard/data/connections', () => ({
  getDataConnection: async () => ({ id: 'connection-1' }),
  deleteDataConnection: (...args: unknown[]) => deleteDataConnectionMock(...args),
  updateDataConnection: (...args: unknown[]) => updateDataConnectionMock(...args)
}))
vi.mock('@vibesboard/data/validate-webhook-url', () => ({
  validateWebhookUrl: () => ({ ok: true })
}))

const { DELETE, PATCH } = await import('./route.ts')
const context = { params: Promise.resolve({ id: 'connection-1' }) }

beforeEach(() => {
  isAdmin = false
  deleteDataConnectionMock.mockClear()
  updateDataConnectionMock.mockClear()
})

describe('data connection administration', () => {
  it('refuses deletion by a non-admin tenant member', async () => {
    const response = await DELETE(new Request('http://localhost'), context)

    expect(response.status).toBe(403)
    expect(deleteDataConnectionMock).not.toHaveBeenCalled()
  })

  it('refuses updates by a non-admin tenant member', async () => {
    const response = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'redirected' })
      }),
      context
    )

    expect(response.status).toBe(403)
    expect(updateDataConnectionMock).not.toHaveBeenCalled()
  })
})
