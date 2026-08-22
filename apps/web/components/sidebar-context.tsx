'use client'

import * as React from 'react'
import { useLocalStorage } from '@/lib/hooks/use-local-storage'

interface SidebarContextValue {
  isSidebarOpen: boolean
  setIsSidebarOpen: (value: boolean) => void
  toggleSidebar: () => void
}

const SidebarContext = React.createContext<SidebarContextValue | undefined>(
  undefined
)

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useLocalStorage(
    'sidebar-is-open',
    true
  )

  const toggleSidebar = React.useCallback(() => {
    setIsSidebarOpen(!isSidebarOpen)
  }, [isSidebarOpen, setIsSidebarOpen])

  const value = React.useMemo(
    () => ({
      isSidebarOpen,
      setIsSidebarOpen,
      toggleSidebar
    }),
    [isSidebarOpen, setIsSidebarOpen, toggleSidebar]
  )

  return (
    <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = React.useContext(SidebarContext)
  if (context === undefined) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return context
}
