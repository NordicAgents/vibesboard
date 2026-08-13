import { Children, cloneElement, isValidElement, type ReactNode } from 'react'

/**
 * Numbered walkthrough. Each direct child `<Step>` becomes one entry; `Steps`
 * injects the position so authors don't hand-number each step themselves.
 */
export function Steps({ children }: { children: ReactNode }) {
  const items = Children.toArray(children)

  return (
    <div className="not-prose my-6 border-l border-border-warm pl-6">
      {Children.map(items, (child, index) =>
        isValidElement(child)
          ? cloneElement(child as React.ReactElement<StepProps>, {
              index: index + 1
            })
          : child
      )}
    </div>
  )
}

interface StepProps {
  title: string
  index?: number
  children: ReactNode
}

export function Step({ title, index, children }: StepProps) {
  return (
    <div className="relative pb-8 last:pb-0">
      <span
        className="absolute left-[-31px] top-0 flex size-[22px] items-center justify-center rounded-full border border-accent-orange bg-bg-base font-mono text-[11px] font-medium text-text-primary"
        aria-hidden
      >
        {index}
      </span>
      <h4 className="mb-2 mt-0 text-base font-semibold text-text-primary">
        {title}
      </h4>
      <div className="text-sm leading-relaxed text-text-secondary [&>:first-child]:mt-0 [&>:last-child]:mb-0">
        {children}
      </div>
    </div>
  )
}
