'use client'

import { useRef, useState, type ComponentProps } from 'react'
import { Check, Copy } from 'lucide-react'

import { cn } from '@vibesboard/utils'

/**
 * Code block chrome around rehype-pretty-code's output. The copy button reads
 * `textContent` off the rendered `<pre>` rather than a prop, since the
 * highlighted text arrives as a tree of per-token spans, not a plain string.
 */
export function DocsPre({
  className,
  children,
  ...props
}: ComponentProps<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    const text = preRef.current?.textContent ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access denied — nothing useful to recover here.
    }
  }

  return (
    <div className="group/pre relative my-5 overflow-hidden rounded-xl border border-border-warm bg-bg-surface">
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="bg-bg-base/90 absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md border border-border-warm text-text-tertiary opacity-0 backdrop-blur transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover/pre:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
      <pre
        ref={preRef}
        className={cn(
          'overflow-x-auto p-4 text-[13px] leading-relaxed',
          className
        )}
        {...props}
      >
        {children}
      </pre>
    </div>
  )
}
