import type { ReactNode } from 'react'

import { DocsHeader } from '@/components/docs/docs-header'
import { DocsSidebarNav } from '@/components/docs/docs-sidebar'

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    // The app shell (root layout) is a fixed h-dvh flex column with
    // overflow-hidden, because the authenticated pages scroll inside their own
    // panes. Docs pages are ordinary long documents, so they need to establish
    // their own scroll container here — without this they overflow the shell
    // and get clipped with no scrollbar at all.
    <div className="h-full overflow-y-auto bg-bg-base text-text-primary">
      <DocsHeader />
      <div className="mx-auto flex max-w-[1440px] items-start gap-10 px-4 py-8 sm:px-6 lg:px-8">
        {/* Caps the sticky rail to the space under the header and lets it
            scroll on its own, so the lower sections of a long nav stay
            reachable on short viewports. */}
        <aside className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] w-60 shrink-0 overflow-y-auto lg:block">
          <DocsSidebarNav />
        </aside>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
