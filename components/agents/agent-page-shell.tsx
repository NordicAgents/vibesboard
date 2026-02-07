'use client'

import * as React from 'react'

import { AgentPageShellProvider } from '@/components/agents/agent-page-shell-context'

export function AgentPageShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(false)

  return (
    <AgentPageShellProvider
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
    >
      <div className="relative flex-1">{children}</div>
    </AgentPageShellProvider>
  )
}
