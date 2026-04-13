'use client'

import * as React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { type UseChatHelpers } from 'ai/react'

import { type AgentMode } from '@/lib/types'
import { PromptForm } from '@/components/prompt-form'
import { ChatCompletionBanner } from '@/components/chat-completion'
import { QuickSuggestions } from '@/components/quick-suggestions'

export interface ChatPanelProps extends Pick<
  UseChatHelpers,
  'append' | 'isLoading' | 'reload' | 'messages' | 'stop' | 'input' | 'setInput'
> {
  id?: string
  isChatComplete?: boolean
  isAgentDisabled?: boolean
  agentMode?: AgentMode
  agentName?: string
  onChatComplete?: () => void
  onCorrect?: () => void
  onEndConversation?: () => void
  quickSuggestions?: string[]
}

export function ChatPanel({
  id,
  isLoading,
  stop,
  append,
  reload,
  input,
  setInput,
  messages,
  isChatComplete,
  isAgentDisabled,
  agentMode = 'provider',
  agentName,
  onChatComplete,
  onCorrect,
  onEndConversation,
  quickSuggestions = []
}: ChatPanelProps) {
  const canRegenerate = React.useMemo(() => {
    if (isLoading || isChatComplete) return false
    const hasUser = messages?.some(m => m.role === 'user')
    const hasAssistant = messages?.some(m => m.role === 'assistant')
    return Boolean(hasUser && hasAssistant)
  }, [isLoading, isChatComplete, messages])

  return (
    /* Full-width background, content centered in same column as messages */
    <div className="relative shrink-0 bg-[#f7f7f5] dark:bg-[#222f30]">
      {/* Gradient fade — full width, bleeds upward into the scroll area */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-12 h-12 bg-gradient-to-b from-transparent to-[#f7f7f5] dark:to-[#222f30]"
        aria-hidden="true"
      />

      {/* Centered content column — matches message column width */}
      <div className="mx-auto w-full max-w-full px-3 pb-5 pt-2 sm:max-w-[760px] sm:px-6">
        <AnimatePresence mode="wait">
          {isChatComplete && !isLoading ? (
            <motion.div
              key="complete"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              <ChatCompletionBanner
                mode={agentMode}
                isAgentDisabled={isAgentDisabled}
                onComplete={onChatComplete ?? (() => {})}
                onCorrect={onCorrect}
              />
            </motion.div>
          ) : (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-2"
            >
              {/* Quick suggestions */}
              <AnimatePresence>
                {quickSuggestions.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <QuickSuggestions
                      suggestions={quickSuggestions}
                      disabled={isLoading || Boolean(isChatComplete)}
                      onSelect={async value => {
                        const trimmed = value.trim()
                        if (!trimmed) return
                        setInput('')
                        await append({
                          id,
                          content: trimmed,
                          role: 'user'
                        })
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Input form */}
              <PromptForm
                onSubmit={async value => {
                  await append({
                    id,
                    content: value,
                    role: 'user'
                  })
                }}
                input={input}
                setInput={setInput}
                isLoading={isLoading}
                onStop={() => stop()}
                canRegenerate={canRegenerate}
                onRegenerate={() => reload()}
              />

              {/* Escape hatch — always accessible so the user is never stuck */}
              {onEndConversation &&
                !isLoading &&
                messages &&
                messages.length > 1 && (
                  <div className="flex justify-center pt-1">
                    <button
                      type="button"
                      onClick={onEndConversation}
                      className="text-xs text-muted-foreground/60 underline-offset-2 transition-colors hover:text-muted-foreground hover:underline"
                    >
                      End conversation
                    </button>
                  </div>
                )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
