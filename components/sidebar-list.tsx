import Link from 'next/link'

import { getAgents, getAgentConversations } from '@/app/actions'
import { SidebarAgentGroup } from '@/components/sidebar-agent-group'
import { TenantSwitcher } from '@/components/tenants'
import { Button } from '@/components/ui/button'
import { IconPlus } from '@/components/ui/icons'
import { getActiveTenant, getUserTenants } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import { MessageSquare, FileText, Users, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

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

  // Check if WhatsApp bulk messaging is enabled for this tenant
  const whatsappBulkEnabled = currentTenantId ? await isFeatureEnabled(currentTenantId, 'whatsapp_bulk_messaging') : false

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
        <div className="flex items-center justify-between px-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#9D9790]">
            Agents
          </span>
        </div>
        {agents?.length ? (
          <div className="space-y-0.5 px-2">
            {agents.map(agent => (
              <SidebarAgentGroup
                key={agent.id}
                agent={agent}
                conversations={conversationsByAgent[agent.id] ?? []}
              />
            ))}
          </div>
        ) : (
          <p className="px-4 text-sm text-[#9D9790]">
            No agents yet. Create one!
          </p>
        )}
      </div>

      {whatsappBulkEnabled && (
        <div className="space-y-2 pb-4 border-t border-[#E2DDD4] dark:border-[#2E2B25] pt-4">
          <div className="flex items-center justify-between px-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#9D9790]">
              WhatsApp Marketing
            </span>
          </div>
          <div className="space-y-0.5 px-2">
            <WhatsAppNavLink href="/whatsapp-bulk/business-accounts" icon={MessageSquare}>
              Business Accounts
            </WhatsAppNavLink>
            <WhatsAppNavLink href="/whatsapp-bulk/templates" icon={FileText}>
              Templates
            </WhatsAppNavLink>
            <WhatsAppNavLink href="/whatsapp-bulk/contacts" icon={Users}>
              Contacts
            </WhatsAppNavLink>
            <WhatsAppNavLink href="/whatsapp-bulk/campaigns" icon={Send}>
              Campaigns
            </WhatsAppNavLink>
          </div>
        </div>
      )}
    </div>
  )
}

function WhatsAppNavLink({
  href,
  icon: Icon,
  children
}: {
  href: string
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150',
        'text-[#1A1915] hover:bg-[#EDE8DE] dark:text-[#E8E3D8] dark:hover:bg-[#2E2B25]'
      )}
    >
      <Icon className="h-4 w-4 text-[#9D9790] transition-colors duration-150 group-hover:text-[#D97757]" />
      {children}
    </Link>
  )
}
