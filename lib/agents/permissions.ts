import 'server-only'

import { isSuperAdmin, isTenantAdmin } from '@/lib/permissions'

export async function canEditAgent(args: {
  sessionUserId: string
  agentOwnerId: string
  tenantId: string | null
}): Promise<boolean> {
  const { sessionUserId, agentOwnerId, tenantId } = args

  if (sessionUserId === agentOwnerId) {
    return true
  }

  if (await isSuperAdmin(sessionUserId)) {
    return true
  }

  if (!tenantId) {
    return false
  }

  return isTenantAdmin(sessionUserId, tenantId)
}
