import { beforeEach, describe, expect, it, vi } from 'vitest'

const isMemberOfTenant = vi.fn()
const isSuperAdmin = vi.fn()
const isTenantAdmin = vi.fn()

vi.mock('@vibesboard/policy/permissions', () => ({
  isMemberOfTenant,
  isSuperAdmin,
  isTenantAdmin
}))

const { canEditAgent } = await import('./permissions.ts')

describe('canEditAgent', () => {
  beforeEach(() => {
    isMemberOfTenant.mockReset()
    isSuperAdmin.mockReset()
    isTenantAdmin.mockReset()
    isMemberOfTenant.mockResolvedValue(false)
    isSuperAdmin.mockResolvedValue(false)
    isTenantAdmin.mockResolvedValue(false)
  })

  it('rejects a former tenant member even when they still own the agent row', async () => {
    await expect(
      canEditAgent({
        sessionUserId: 'former-member',
        agentOwnerId: 'former-member',
        tenantId: 'tenant-a'
      })
    ).resolves.toBe(false)
  })

  it('allows a current tenant member who owns the agent', async () => {
    isMemberOfTenant.mockResolvedValue(true)

    await expect(
      canEditAgent({
        sessionUserId: 'owner',
        agentOwnerId: 'owner',
        tenantId: 'tenant-a'
      })
    ).resolves.toBe(true)
  })

  it('allows a platform superadmin without tenant membership', async () => {
    isSuperAdmin.mockResolvedValue(true)

    await expect(
      canEditAgent({
        sessionUserId: 'superadmin',
        agentOwnerId: 'owner',
        tenantId: 'tenant-a'
      })
    ).resolves.toBe(true)
  })
})
