import Link from 'next/link'

import { getAgents, getAgentConversations } from '@/app/actions'
import { SidebarAgentGroup } from '@/components/sidebar-agent-group'
import { TenantSwitcher } from '@/components/tenants'
import { Button } from '@/components/ui/button'
import { IconPlus } from '@/components/ui/icons'
import { getActiveTenant, getUserTenants, enrichTenantsWithMembers } from '@/lib/tenant-context'
import { isFeatureEnabled } from '@/lib/features'
import { MessageSquare, FileText, Users, Send, Inbox, Link as LinkIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface SidebarListProps {
  userId?: string
}

export async function SidebarList({ userId }: SidebarListProps) {
  const currentTenantId = userId ? await getActiveTenant(userId) : null
  const rawTenants = userId ? await getUserTenants(userId) : []
  const tenants = rawTenants.length > 0
    ? await enrichTenantsWithMembers(rawTenants)
    : []

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

  // Check if WhatsApp features are enabled for this tenant
  const [whatsappBulkEnabled, whatsappInboxEnabled] = await Promise.all([
    currentTenantId
      ? isFeatureEnabled(currentTenantId, 'whatsapp_bulk_messaging')
      : Promise.resolve(false),
    currentTenantId
      ? isFeatureEnabled(currentTenantId, 'WHATSAPP_INBOX')
      : Promise.resolve(false),
  ])

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
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6f7f80]">
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
          <p className="px-4 text-sm text-[#6f7f80]">
            No agents yet. Create one!
          </p>
        )}
      </div>

      {whatsappBulkEnabled && (
        <div className="space-y-2 border-t border-[#e4e3e3] py-4 dark:border-[#344348]">
          <div className="flex items-center justify-between px-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6f7f80]">
              WhatsApp Marketing
            </span>
          </div>
          <div className="space-y-0.5 px-2">
            <WhatsAppNavLink
              href="/whatsapp-bulk/business-accounts"
              icon={MessageSquare}
            >
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

      {whatsappInboxEnabled && (
        <div className="space-y-2 border-t border-[#e4e3e3] py-4 dark:border-[#344348]">
          <div className="flex items-center justify-between px-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6f7f80]">
              WhatsApp Inbox
            </span>
          </div>
          <div className="space-y-0.5 px-2">
            <WhatsAppNavLink
              href="/whatsapp-inbox/conversations"
              icon={Inbox}
            >
              Inbox
            </WhatsAppNavLink>
            <WhatsAppNavLink
              href="/whatsapp-inbox/accounts"
              icon={LinkIcon}
            >
              Accounts
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
        'text-[#222f30] hover:bg-[#e6ede6] dark:text-[#f5f8f7] dark:hover:bg-[#344348]'
      )}
    >
      <Icon className="size-4 text-[#6f7f80] transition-colors duration-150 group-hover:text-accent-orange" />
      {children}
    </Link>
  )
}
