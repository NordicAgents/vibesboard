'use client'

import * as React from 'react'

import { AgentRightbar } from '@/components/agents/agent-rightbar'
import { AgentPageShellProvider } from '@/components/agents/agent-page-shell-context'
import {
  type AgentSharePayload,
  type VibeAgent,
  type VibeAgentConversation
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'

interface AgentPageShellProps {
  agent: VibeAgent
  share: AgentSharePayload
  conversations: VibeAgentConversation[]
  children: React.ReactNode
}

export function AgentPageShell({
  agent,
  share,
  conversations,
  children
}: AgentPageShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true)

  return (
    <AgentPageShellProvider isSidebarOpen={isSidebarOpen}>
      <div className="relative flex-1">
        {/* Mobile trigger */}
        <div className="container mx-auto flex justify-end px-4 pt-4 lg:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary" size="sm">
                Agent Details
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[96vw] sm:w-[520px]">
              <SheetHeader>
                <SheetTitle>Agent Details</SheetTitle>
              </SheetHeader>
              <div className="mt-4 overflow-y-auto pb-6">
                <AgentRightbar
                  agent={agent}
                  share={share}
                  conversations={conversations}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Main area with responsive margin depending on sidebar visibility */}
        <div
          className={cn(
            'transition-[margin] duration-200',
            isSidebarOpen ? 'lg:mr-[520px]' : 'lg:mr-0'
          )}
        >
          {children}
        </div>

        {/* Desktop sidebar */}
        <div className="hidden lg:block">
          <div
            className={cn(
              'fixed top-16 right-0 bottom-0 max-w-[520px] w-[90vw] overflow-y-auto border-l bg-background p-4 shadow-lg transition-transform duration-200',
              isSidebarOpen ? 'translate-x-0' : 'translate-x-full'
            )}
          >
            <AgentRightbar
              agent={agent}
              share={share}
              conversations={conversations}
              onClose={() => setIsSidebarOpen(false)}
            />
          </div>
          {!isSidebarOpen && (
            <Button
              variant="secondary"
              size="sm"
              className="fixed right-4 top-[calc(4rem+1rem)] shadow-md"
              onClick={() => setIsSidebarOpen(true)}
            >
              Configure Agent
            </Button>
          )}
        </div>
      </div>
    </AgentPageShellProvider>
  )
}
