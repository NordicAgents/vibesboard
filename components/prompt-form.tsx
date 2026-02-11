'use client'

import * as React from 'react'
import Textarea from 'react-textarea-autosize'
import { motion } from 'framer-motion'
import type { UseChatHelpers } from 'ai/react'

import { useEnterSubmit } from '@/lib/hooks/use-enter-submit'
import { cn } from '@/lib/utils'

export interface PromptProps extends Pick<
  UseChatHelpers,
  'input' | 'setInput'
> {
  onSubmit: (value: string) => Promise<void>
  isLoading: boolean
  placeholder?: string
  onStop?: () => void
  canRegenerate?: boolean
  onRegenerate?: () => void
}

export function PromptForm({
  onSubmit,
  input,
  setInput,
  isLoading,
  placeholder = 'Message…',
  onStop,
  canRegenerate,
  onRegenerate
}: PromptProps) {
  const { formRef, onKeyDown } = useEnterSubmit()
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const hasInput = input.trim().length > 0

  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  const showStop = Boolean(isLoading && onStop)

  return (
    <form
      onSubmit={async e => {
        e.preventDefault()
        if (!input?.trim()) return
        setInput('')
        await onSubmit(input)
      }}
      ref={formRef}
    >
      <div className="flex items-end gap-2">
        {/* Textarea container */}
        <div className="relative flex min-h-[44px] flex-1 items-end rounded-2xl border border-border/60 bg-background px-4 py-2.5 shadow-sm transition-all duration-200 focus-within:border-ring/50 focus-within:shadow-md focus-within:shadow-ring/5">
          <Textarea
            ref={inputRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            rows={1}
            maxRows={6}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            className="w-full resize-none bg-transparent text-sm leading-relaxed focus:outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
            style={{ lineHeight: '1.5' }}
          />
        </div>

        {/* Action button */}
        <div className="flex shrink-0 items-center gap-1.5">
          {/* Regenerate button */}
          {!isLoading && canRegenerate && onRegenerate && (
            <motion.button
              type="button"
              onClick={() => onRegenerate?.()}
              whileTap={{ scale: 0.92 }}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/50 bg-background text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80"
              aria-label="Regenerate response"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </motion.button>
          )}

          {/* Stop / Send button */}
          {showStop ? (
            <motion.button
              type="button"
              onClick={() => onStop?.()}
              whileTap={{ scale: 0.92 }}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background shadow-sm transition-colors hover:bg-foreground/80 active:bg-foreground/70"
              aria-label="Stop generating"
            >
              <span className="h-3.5 w-3.5 rounded-sm bg-current" />
            </motion.button>
          ) : (
            <motion.button
              type="submit"
              disabled={!hasInput || isLoading}
              whileTap={hasInput ? { scale: 0.92 } : {}}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-xl shadow-sm transition-all duration-200',
                hasInput
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80'
                  : 'bg-muted text-muted-foreground cursor-not-allowed'
              )}
              aria-label="Send message"
            >
              <motion.svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                animate={hasInput ? { y: 0 } : { y: 0 }}
              >
                <path d="M12 19V5" />
                <path d="m5 12 7-7 7 7" />
              </motion.svg>
            </motion.button>
          )}
        </div>
      </div>
    </form>
  )
}
