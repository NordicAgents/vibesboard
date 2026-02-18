'use client'

import * as React from 'react'
import { type UseChatHelpers } from 'ai/react'

import { type AgentMode } from '@/lib/types'
import { PromptForm } from '@/components/prompt-form'
import { ButtonScrollToBottom } from '@/components/button-scroll-to-bottom'
import { ChatCompletionBanner } from '@/components/chat-completion'
import { QuickSuggestions } from '@/components/quick-suggestions'
// Footer has been removed for a cleaner UI

export interface ChatPanelProps extends Pick<
  UseChatHelpers,
  'append' | 'isLoading' | 'reload' | 'messages' | 'stop' | 'input' | 'setInput'
> {
  id?: string
  isChatComplete?: boolean
  agentMode?: AgentMode
  agentName?: string
  onChatComplete?: () => void
  quickSuggestions?: string[]
  onHeightChange?: (height: number) => void
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
  agentMode = 'provider',
  agentName,
  onChatComplete,
  quickSuggestions = [],
  onHeightChange
}: ChatPanelProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!onHeightChange) return
    const node = panelRef.current
    if (!node) return

    let frameId: number | null = null
    const reportHeight = () => {
      if (frameId != null) {
        cancelAnimationFrame(frameId)
      }
      frameId = requestAnimationFrame(() => {
        onHeightChange(node.getBoundingClientRect().height)
      })
    }

    reportHeight()

    const observer = new ResizeObserver(reportHeight)
    observer.observe(node)
    window.addEventListener('resize', reportHeight, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', reportHeight)
      if (frameId != null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [onHeightChange])

  const canRegenerate = React.useMemo(() => {
    if (isLoading || isChatComplete) return false
    const hasUser = messages?.some(m => m.role === 'user')
    const hasAssistant = messages?.some(m => m.role === 'assistant')
    return Boolean(hasUser && hasAssistant)
  }, [isLoading, isChatComplete, messages])

  // If chat is complete, show completion UI instead of input
  if (isChatComplete && !isLoading) {
    return (
      <div ref={panelRef} className="fixed inset-x-0 bottom-0">
        <div className="mx-auto sm:max-w-2xl sm:px-4">
          <div className="space-y-4 px-4 py-4">
            <ChatCompletionBanner
              mode={agentMode}
              onComplete={onChatComplete ?? (() => {})}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div ref={panelRef} className="fixed inset-x-0 bottom-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-t">
      <ButtonScrollToBottom />
      <div className="mx-auto sm:max-w-2xl sm:px-4">
        <div className="space-y-4 px-4 py-2 md:py-4">
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
          {/* Footer removed */}
        </div>
      </div>
    </div>
  )
}
