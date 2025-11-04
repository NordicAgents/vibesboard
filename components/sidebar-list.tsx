import Link from 'next/link'

import {
  getAgents,
  getChats,
  getAgentConversations,
  removeChat,
  shareChat
} from '@/app/actions'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger
} from '@/components/ui/tooltip'

export interface SidebarListProps {
  userId?: string
}

export async function SidebarList({ userId }: SidebarListProps) {
  const [agents, chats, conversations] = await Promise.all([
    getAgents(userId),
    getChats(userId),
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
              <div key={agent.id} className="space-y-1">
                <SidebarAgentItem agent={agent} />
                {conversationsByAgent[agent.id]?.length ? (
                  <div className="ml-6 space-y-1">
                    {conversationsByAgent[agent.id].map(session => {
                      const label =
                        session.summary ||
                        session.messages.at(-1)?.content?.slice(0, 80) ||
                        'Conversation'
                      return (
                        <Link
                          key={session.id}
                          href={`/agents/${agent.id}?session=${session.id}`}
                          className="block truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted/50"
                          title={label}
                        >
                          {label}
                        </Link>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 text-sm text-muted-foreground">
            No agents yet. Create one!
          </p>
        )}
      </div>
      <div className="space-y-2 px-2">
        <div className="flex items-center gap-2 px-2 text-xs font-semibold tracking-wide text-muted-foreground">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                aria-label="Start a new chat"
                title="Start a new chat"
              >
                <Link href="/">
                  <IconPlus className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>New chat</TooltipContent>
          </Tooltip>
          <span>Chats</span>
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
