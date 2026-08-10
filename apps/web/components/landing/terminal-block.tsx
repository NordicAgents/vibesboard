'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

import { cn } from '@vibesboard/utils'

/**
 * A shell block with a copy button.
 *
 * Comment lines render without a prompt so the block reads like something you
 * would actually paste. Copy takes the raw text, comments included — silently
 * rewriting what someone copied is worse than a stray `#`.
 */
export function TerminalBlock({
  command,
  title = 'bash',
  className
}: {
  command: string
  title?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      // Clipboard access can be denied; the text stays selectable either way.
    }
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-white/10 bg-[#0c1413] font-mono text-[13px] shadow-md',
        className
      )}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="ml-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {title}
          </span>
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3.5 text-primary" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <pre className="overflow-x-auto p-4 leading-relaxed">
        <code>
          {command.split('\n').map((line, index) => (
            <span key={index} className="block whitespace-pre">
              {line === '' ? (
                ' '
              ) : line.trimStart().startsWith('#') ? (
                <span className="pl-6 text-muted-foreground">{line}</span>
              ) : (
                <>
                  <span className="select-none pr-3 text-white/25" aria-hidden>
                    $
                  </span>
                  <span className="text-[#dbe7e2]">{line}</span>
                </>
              )}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}
