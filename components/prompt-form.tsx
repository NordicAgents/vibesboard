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
          'flex flex-col rounded-[16px] border transition-all duration-[250ms]',
          'bg-[#FDFAF5] dark:bg-[#221F1A]',
          'border-[#E2DDD4] dark:border-[#2E2B25]',
          'shadow-[0_1px_3px_rgba(26,25,21,0.06),_0_4px_16px_rgba(26,25,21,0.04)]',
          'focus-within:border-[#D97757]/60 focus-within:shadow-[0_0_0_3px_rgba(217,119,87,0.10),_0_1px_3px_rgba(26,25,21,0.06)]'
        )}
      >
        {/* Textarea */}
        <div className="px-4 pt-3.5 pb-1">
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
            className="w-full resize-none bg-transparent text-[15px] leading-[1.65] text-[#1A1915] focus:outline-none placeholder:text-[#9D9790] disabled:opacity-50 dark:text-[#E8E3D8] dark:placeholder:text-[#6B6560]"
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
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E2DDD4] bg-transparent text-[#9D9790] transition-all duration-150 hover:border-[#D97757]/30 hover:bg-[#EDE8DE] hover:text-[#6B6560] dark:border-[#2E2B25] dark:hover:bg-[#2E2B25]"
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
                    className="h-3.5 w-3.5"
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
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1A1915] text-[#FDFAF5] transition-colors duration-150 hover:bg-[#2E2B25] dark:bg-[#E8E3D8] dark:text-[#1A1915]"
                  aria-label="Stop generating"
                >
                  <span className="h-3 w-3 rounded-sm bg-current" />
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
                    'flex h-8 w-8 items-center justify-center rounded-full transition-all duration-150',
                    hasInput
                      ? 'bg-[#D97757] text-white hover:bg-[#CC785C] active:bg-[#BF6E52] shadow-sm'
                      : 'bg-[#E2DDD4] text-[#9D9790] cursor-not-allowed dark:bg-[#2E2B25] dark:text-[#6B6560]'
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
                    className="h-3.5 w-3.5"
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
