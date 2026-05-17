'use client'

import * as React from 'react'

interface AgentPageShellContextValue {
  isSidebarOpen: boolean
  setIsSidebarOpen: (isOpen: boolean) => void
}

const AgentPageShellContext =
  React.createContext<AgentPageShellContextValue | null>(null)

export function AgentPageShellProvider({
  isSidebarOpen,
  setIsSidebarOpen,
  children
}: {
  isSidebarOpen: boolean
  setIsSidebarOpen: (isOpen: boolean) => void
  children: React.ReactNode
}) {
  return (
    <AgentPageShellContext.Provider value={{ isSidebarOpen, setIsSidebarOpen }}>
      {children}
    </AgentPageShellContext.Provider>
  )
}

export function useAgentPageShell() {
  return React.useContext(AgentPageShellContext)
}
