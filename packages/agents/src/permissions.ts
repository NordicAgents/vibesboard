import 'server-only'

import {
  isMemberOfTenant,
  isSuperAdmin,
  isTenantAdmin
} from '@vibesboard/policy/permissions'

export async function canEditAgent(args: {
  sessionUserId: string
  agentOwnerId: string
  tenantId: string | null
}): Promise<boolean> {
  const { sessionUserId, agentOwnerId, tenantId } = args

  if (await isSuperAdmin(sessionUserId)) {
    return true
  }

  if (!tenantId) {
    return false
  }

  // Ownership is meaningful only while the owner remains a member of the
  // workspace. Tenant admins can remove a user immediately; leaving the stale
  // user_id on an agent row must not turn that row into a permanent backdoor.
  if (sessionUserId === agentOwnerId) {
    return isMemberOfTenant(sessionUserId, tenantId)
  }

  return isTenantAdmin(sessionUserId, tenantId)
}
