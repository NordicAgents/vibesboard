'use client'

import * as React from 'react'
import Textarea from 'react-textarea-autosize'
import { motion, AnimatePresence } from 'framer-motion'
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
      {/* Claude-style: everything inside one rounded container */}
      <div
        className={cn(
          'duration-[250ms] flex flex-col rounded-[16px] border transition-all',
          'bg-[#F7F7F5] dark:bg-[#141414]',
          'border-[#E5E5E5] dark:border-[#2A2A2A]',
          'shadow-[0_1px_3px_rgba(0,0,0,0.06),_0_4px_16px_rgba(0,0,0,0.04)]',
          'focus-within:border-[#00C853]/60 focus-within:shadow-[0_0_0_3px_rgba(0,200,83,0.10),_0_1px_3px_rgba(0,0,0,0.06)]'
        )}
      >
        {/* Textarea */}
        <div className="px-4 pb-1 pt-3.5">
          <Textarea
            ref={inputRef}
            tabIndex={0}
            onKeyDown={onKeyDown}
            rows={1}
            maxRows={8}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            className="w-full resize-none bg-transparent text-[15px] leading-[1.65] text-[#1A1A1A] placeholder:text-[#8A8A8A] focus:outline-none disabled:opacity-50 dark:text-[#F0F0F0] dark:placeholder:text-[#666666]"
          />
        </div>

        {/* Bottom toolbar — actions inside the box */}
        <div className="flex items-center justify-between px-3 pb-3 pt-1">
          {/* Left side — empty for now, can add attach button later */}
          <div />

          {/* Right side — regenerate + send/stop */}
          <div className="flex items-center gap-2">
            {/* Regenerate button */}
            <AnimatePresence>
              {!isLoading && canRegenerate && onRegenerate && (
                <motion.button
                  type="button"
                  onClick={() => onRegenerate?.()}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.92 }}
                  className="flex size-8 items-center justify-center rounded-full border border-[#E5E5E5] bg-transparent text-[#8A8A8A] transition-all duration-150 hover:border-[#00C853]/30 hover:bg-[#EFEFED] hover:text-[#5A5A5A] dark:border-[#2A2A2A] dark:hover:bg-[#1E1E1E]"
                  aria-label="Regenerate response"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-3.5"
                  >
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>

            {/* Stop / Send button */}
            <AnimatePresence mode="wait">
              {showStop ? (
                <motion.button
                  key="stop"
                  type="button"
                  onClick={() => onStop?.()}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  whileTap={{ scale: 0.92 }}
                  className="flex size-8 items-center justify-center rounded-full bg-[#1A1A1A] text-[#F7F7F5] transition-colors duration-150 hover:bg-[#2A2A2A] dark:bg-[#F0F0F0] dark:text-[#0A0A0A]"
                  aria-label="Stop generating"
                >
                  <span className="size-3 rounded-sm bg-current" />
                </motion.button>
              ) : (
                <motion.button
                  key="send"
                  type="submit"
                  disabled={!hasInput || isLoading}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{
                    opacity: hasInput ? 1 : 0.35,
                    scale: 1
                  }}
                  whileTap={hasInput ? { scale: 0.92 } : {}}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full transition-all duration-150',
                    hasInput
                      ? 'bg-accent-orange text-white shadow-sm hover:bg-accent-warm active:opacity-80'
                      : 'cursor-not-allowed bg-[#E5E5E5] text-[#8A8A8A] dark:bg-[#2A2A2A] dark:text-[#666666]'
                  )}
                  aria-label="Send message"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-3.5"
                  >
                    <path d="M12 19V5" />
                    <path d="m5 12 7-7 7 7" />
                  </svg>
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </form>
  )
}
