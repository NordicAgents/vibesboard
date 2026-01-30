'use client'

import * as React from 'react'

interface AgentPageShellContextValue {
  isSidebarOpen: boolean
}

const AgentPageShellContext = React.createContext<AgentPageShellContextValue | null>(
  null
)

export function AgentPageShellProvider({
  isSidebarOpen,
  children
}: {
  isSidebarOpen: boolean
  children: React.ReactNode
}) {
  return (
    <AgentPageShellContext.Provider value={{ isSidebarOpen }}>
      {children}
    </AgentPageShellContext.Provider>
  )
}

export function useAgentPageShell() {
  return React.useContext(AgentPageShellContext)
}

