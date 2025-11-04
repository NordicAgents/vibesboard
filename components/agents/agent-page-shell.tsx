'use client'

import * as React from 'react'

import { AgentRightbar } from '@/components/agents/agent-rightbar'
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
    <div className="relative flex-1">
      {/* Mobile trigger */}
      <div className="container mx-auto px-4 pt-4 lg:hidden">
        <div className="flex items-center justify-end">
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
      </div>

      {/* Main area with responsive margin depending on sidebar visibility */}
      <div
        className={cn(
          'transition-[margin-right] duration-200',
          isSidebarOpen ? 'lg:mr-[520px]' : 'lg:mr-0'
        )}
      >
        {children}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <div
          className={cn(
            'fixed right-0 top-16 bottom-0 w-[90vw] max-w-[520px] overflow-y-auto border-l bg-background p-4 shadow-lg transition-transform duration-200',
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
            Open sidebar
          </Button>
        )}
      </div>
    </div>
  )
}
