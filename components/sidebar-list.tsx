import Link from 'next/link'

import { getAgents, getChats, removeChat, shareChat } from '@/app/actions'
import { SidebarActions } from '@/components/sidebar-actions'
import { SidebarItem } from '@/components/sidebar-item'
import { SidebarAgentItem } from '@/components/sidebar-agent-item'
import { buttonVariants } from '@/components/ui/button'

export interface SidebarListProps {
  userId?: string
}

export async function SidebarList({ userId }: SidebarListProps) {
  const [agents, chats] = await Promise.all([
    getAgents(userId),
    getChats(userId)
  ])

  return (
    <div className="flex-1 overflow-auto space-y-4">
      <div className="space-y-2 border-b pb-4">
        <div className="flex items-center justify-between px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Agents</span>
          <div className="flex items-center gap-2">
            <Link
              href="/agents/new"
              className={buttonVariants({
                variant: 'ghost',
                size: 'sm'
              })}
            >
              New
            </Link>
            <Link
              href="/agents/new/chat"
              className={buttonVariants({
                variant: 'ghost',
                size: 'sm'
              })}
              title="Create via chat"
            >
              New via Chat
            </Link>
          </div>
        </div>
        {agents?.length ? (
          <div className="space-y-1 px-2">
            {agents.map(agent => (
              <SidebarAgentItem key={agent.id} agent={agent} />
            ))}
          </div>
        ) : (
          <p className="px-4 text-sm text-muted-foreground">
            No agents yet. Create one!
          </p>
        )}
      </div>
      <div className="space-y-2 px-2">
        <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Chats
        </div>
        {chats?.length ? (
          <div className="space-y-2">
            {chats.map(
              chat =>
                chat && (
                  <SidebarItem key={chat?.id} chat={chat}>
                    <SidebarActions
                      chat={chat}
                      removeChat={removeChat}
                      shareChat={shareChat}
                    />
                  </SidebarItem>
                )
            )}
          </div>
        ) : (
          <p className="px-2 text-sm text-muted-foreground">No chat history</p>
        )}
      </div>
    </div>
  )
}
