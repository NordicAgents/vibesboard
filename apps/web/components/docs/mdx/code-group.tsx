'use client'

import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode
} from 'react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { slugify } from '@vibesboard/utils'

interface CodeGroupItemProps {
  label: string
  children: ReactNode
}

export function CodeGroupItem({ children }: CodeGroupItemProps) {
  return <>{children}</>
}

/**
 * Tabbed code samples, e.g. one tab per package manager. Wrap each variant in
 * `<CodeGroupItem label="bun">` — the label doubles as the tab value.
 */
export function CodeGroup({ children }: { children: ReactNode }) {
  const items = Children.toArray(children).filter(
    (child): child is ReactElement<CodeGroupItemProps> =>
      isValidElement(child) &&
      Boolean((child.props as CodeGroupItemProps)?.label)
  )

  if (items.length === 0) {
    return null
  }

  const firstValue = slugify(items[0].props.label)

  return (
    <div className="not-prose my-5">
      <Tabs defaultValue={firstValue}>
        <TabsList>
          {items.map(item => (
            <TabsTrigger
              key={item.props.label}
              value={slugify(item.props.label)}
            >
              {item.props.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {items.map(item => (
          <TabsContent
            key={item.props.label}
            value={slugify(item.props.label)}
            className="mt-2"
          >
            {item}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
