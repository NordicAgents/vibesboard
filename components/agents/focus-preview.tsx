'use client'

import type { QuickSuggestionsMode } from '@/lib/types'
import { Bot, Send } from 'lucide-react'

interface FocusPreviewProps {
  agentName: string
  greetingText: string
  quickSuggestionsMode: QuickSuggestionsMode
}

const SAMPLE_SUGGESTIONS = ['Tell me more', 'What can you do?', 'Get started']

export function FocusPreview({
  agentName,
  greetingText,
  quickSuggestionsMode
}: FocusPreviewProps) {
  const showSuggestions = quickSuggestionsMode !== 'off'
  const displayGreeting =
    greetingText.trim() || 'Hi How can i help you today'

  return (
    <div className="flex flex-col items-center">
      <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-[#9d9790]">
        Visitor preview
      </p>
      <div className="w-[340px] overflow-hidden rounded-3xl border border-[#e4e3e3] bg-white shadow-lg dark:border-[#344348] dark:bg-[#1a2425]">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-[#e4e3e3] bg-[#f5f8f7] px-4 py-3 dark:border-[#344348] dark:bg-[#192425]">
          <div className="flex size-8 items-center justify-center rounded-full bg-[#e6ede6] dark:bg-[#344348]">
            <Bot className="size-4 text-[#445e5f] dark:text-[#c9cbbe]" />
          </div>
          <span className="truncate text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
            {agentName || 'Your Agent'}
          </span>
        </div>

        {/* Chat area */}
        <div className="flex min-h-[320px] flex-col justify-between p-4">
          <div>
            {/* Greeting message */}
            <div className="flex gap-2">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#e6ede6] dark:bg-[#344348]">
                <Bot className="size-3 text-[#445e5f] dark:text-[#c9cbbe]" />
              </div>
              <div className="max-w-[260px] rounded-2xl rounded-tl-md bg-[#f5f8f7] px-3.5 py-2.5 text-sm text-[#222f30] dark:bg-[#192425] dark:text-[#f5f8f7]">
                {displayGreeting}
              </div>
            </div>

            {/* Quick suggestions */}
            {showSuggestions && (
              <div className="mt-3 flex flex-wrap gap-1.5 pl-8">
                {SAMPLE_SUGGESTIONS.map(s => (
                  <span
                    key={s}
                    className="inline-block rounded-full border border-[#e4e3e3] bg-white px-3 py-1.5 text-xs text-[#445e5f] dark:border-[#344348] dark:bg-[#1a2425] dark:text-[#c9cbbe]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Input bar */}
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#e4e3e3] bg-[#f5f8f7] px-3 py-2.5 dark:border-[#344348] dark:bg-[#192425]">
            <span className="flex-1 text-sm text-[#9d9790]">Message...</span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#e4e3e3] dark:bg-[#344348]">
              <Send className="size-3.5 text-[#9d9790]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
