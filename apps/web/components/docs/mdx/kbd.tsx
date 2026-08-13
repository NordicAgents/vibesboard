import type { ReactNode } from 'react'

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-border-warm bg-bg-surface px-1.5 py-0.5 font-mono text-[12px] font-medium text-text-secondary shadow-[0_1px_0_var(--border-warm)]">
      {children}
    </kbd>
  )
}
