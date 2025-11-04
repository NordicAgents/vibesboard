import Link from 'next/link'

import { getAgents, getChats, removeChat, shareChat } from '@/app/actions'
import { SidebarActions } from '@/components/sidebar-actions'
import { SidebarItem } from '@/components/sidebar-item'
import { SidebarAgentItem } from '@/components/sidebar-agent-item'
import { Button } from '@/components/ui/button'
import { IconPlus } from '@/components/ui/icons'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

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
        <div className="flex items-center justify-between px-4 text-xs font-semibold tracking-wide text-muted-foreground">
          <span>Agents</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Create agent"
                title="Create agent"
              >
                <IconPlus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem asChild>
                <Link href="/agents/new" className="flex w-full items-center justify-between">
                  <span>UI builder</span>
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/agents/new/chat" className="flex w-full items-center justify-between">
                  <span>Chat builder</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
        <div className="px-2 text-xs font-semibold tracking-wide text-muted-foreground">
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
