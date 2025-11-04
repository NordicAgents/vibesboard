import Link from 'next/link'

import { getAgents, getAgentConversations } from '@/app/actions'
import { SidebarAgentGroup } from '@/components/sidebar-agent-group'
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
      <div className="space-y-2 pb-4">
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
                <Link href="/" className="flex w-full items-center justify-between">
                  <span>Chat builder</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
