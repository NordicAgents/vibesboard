import type { ReactNode } from 'react'

import { DocsHeader } from '@/components/docs/docs-header'
import { DocsSidebarNav } from '@/components/docs/docs-sidebar'

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg-base text-text-primary">
      <DocsHeader />
      <div className="mx-auto flex max-w-[1440px] items-start gap-10 px-4 py-8 sm:px-6 lg:px-8">
        <aside className="sticky top-24 hidden w-60 shrink-0 lg:block">
          <DocsSidebarNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
