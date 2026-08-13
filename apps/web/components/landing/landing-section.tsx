import { cn } from '@vibesboard/utils'

/**
 * Section shell: numbered mono label on the left, statement heading on the
 * right. Keeps the vertical rhythm identical across every section so the page
 * reads as one document rather than a stack of blocks.
 */
export function LandingSection({
  id,
  label,
  heading,
  description,
  children,
  className,
  contentClassName
}: {
  id?: string
  label: string
  heading: string
  description?: string
  children?: React.ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <section
      id={id}
      className={cn(
        'scroll-mt-24 border-t border-white/5 px-4 py-16 sm:px-6 sm:py-20 lg:py-24',
        className
      )}
    >
      <div className="container mx-auto">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:gap-12 lg:mb-14">
          <h2 className="shrink-0 pt-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground md:w-48">
            {label}
          </h2>
          <div className="max-w-3xl">
            <p className="font-switzer text-2xl leading-tight text-foreground sm:text-3xl lg:text-4xl">
              {heading}
            </p>
            {description && (
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className={cn(contentClassName)}>{children}</div>
      </div>
    </section>
  )
}

/** A screenshot in a browser chrome — reads as product, not as stock art. */
export function BrowserFrame({
  children,
  label,
  className
}: {
  children: React.ReactNode
  label?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-white/10 bg-[#0c1413] shadow-md',
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        <span className="size-2.5 rounded-full bg-white/15" />
        {label && (
          <span className="ml-3 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}
