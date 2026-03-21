'use client'

import * as React from 'react'

export type SecondarySidebarSetter = React.Dispatch<
  React.SetStateAction<React.ReactNode | null>
>

const SecondarySidebarSetterContext = React.createContext<
  SecondarySidebarSetter | undefined
>(undefined)

export function SecondarySidebarSetterProvider({
  setSecondarySidebar,
  children
}: {
  setSecondarySidebar: SecondarySidebarSetter
  children: React.ReactNode
}) {
  return (
    <SecondarySidebarSetterContext.Provider value={setSecondarySidebar}>
      {children}
    </SecondarySidebarSetterContext.Provider>
  )
}

export function useSecondarySidebarSetter() {
  const context = React.useContext(SecondarySidebarSetterContext)
  if (context === undefined) {
    throw new Error(
      'useSecondarySidebarSetter must be used within a SecondarySidebarSetterProvider'
    )
  }
  return context
}
