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
    <div className="flex-1 space-y-4 overflow-auto">
      <div className="px-2">
        <TenantSwitcher
          tenants={tenants}
          currentTenantId={currentTenantId}
          className="w-full"
        />
      </div>
      <div className="space-y-2 pb-4">
        <div className="flex items-center justify-between px-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8A8A8A]">
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
          <p className="px-4 text-sm text-[#8A8A8A]">
            No agents yet. Create one!
          </p>
        )}
      </div>

      {whatsappBulkEnabled && (
        <div className="space-y-2 border-t border-[#E5E5E5] py-4 dark:border-[#2A2A2A]">
          <div className="flex items-center justify-between px-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#8A8A8A]">
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
        'text-[#1A1A1A] hover:bg-[#EFEFED] dark:text-[#F0F0F0] dark:hover:bg-[#2A2A2A]'
      )}
    >
      <Icon className="size-4 text-[#8A8A8A] transition-colors duration-150 group-hover:text-accent-orange" />
      {children}
    </Link>
  )
}
