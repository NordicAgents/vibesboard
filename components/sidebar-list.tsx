import Link from 'next/link'

import { getAgents, getAgentConversations } from '@/app/actions'
import { SidebarAgentGroup } from '@/components/sidebar-agent-group'
import { TenantSwitcher } from '@/components/tenants'
import { Button } from '@/components/ui/button'
import { IconPlus } from '@/components/ui/icons'
import { getActiveTenant, getUserTenants } from '@/lib/tenant-context'

export interface SidebarListProps {
  userId?: string
}

export async function SidebarList({ userId }: SidebarListProps) {
  const currentTenantId = userId ? await getActiveTenant(userId) : null
  const tenants = userId ? await getUserTenants(userId) : []

  const [agents, conversations] = await Promise.all([
    getAgents(userId),
    getAgentConversations(userId)
  ])

  const conversationsByAgent = conversations.reduce(
    (acc, convo) => {
      if (!acc[convo.agentId]) acc[convo.agentId] = []
      acc[convo.agentId].push(convo)
      return acc
    },
    {} as Record<string, typeof conversations>
  )

  return (
    <div className="flex-1 overflow-auto space-y-4">
      <div className="px-2">
        <TenantSwitcher
          tenants={tenants}
          currentTenantId={currentTenantId}
          className="w-full"
        />
      </div>
      <div className="space-y-2 pb-4">
        <div className="flex items-center justify-between px-4 text-xs font-semibold tracking-wide text-muted-foreground">
          <span>Agents</span>
        </div>
        {agents?.length ? (
          <div className="space-y-1 px-2">
            {agents.map(agent => (
              <SidebarAgentGroup
                key={agent.id}
                agent={agent}
                conversations={conversationsByAgent[agent.id] ?? []}
              />
            ))}
          </div>
        ) : (
          <p className="px-4 text-sm text-muted-foreground">
            No agents yet. Create one!
          </p>
        )}
      </div>
    </div>
  )
}
