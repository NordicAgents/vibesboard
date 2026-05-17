'use client'

import { type Message } from '@vibesboard/contracts'
import { motion, AnimatePresence } from 'framer-motion'

import { ChatMessage } from '@/components/chat-message'
import { ChatHandoffIndicator } from '@/components/chat-handoff-indicator'

export interface ChatListProps {
  messages: Message[]
  isLoading?: boolean
  agentAvatarGradient?: string
  agentAvatarInitial?: string
  agentLogoUrl?: string | null
  handoffIndicatorPrefix?: string
  variant?: 'default' | 'transcript'
  assistantLabel?: string
  userLabel?: string
  showMessageActions?: boolean
}

// Typing indicator — warm dots, aligned with AI avatar column
function TypingIndicator({ logoUrl }: { logoUrl?: string | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-center gap-3"
    >
      {/* Avatar placeholder to align with AI messages */}
      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#e4e3e3] bg-[#f5f8f7] shadow-[0_1px_3px_rgba(0,0,0,0.06)] dark:border-[#344348] dark:bg-[#192425]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl || '/logo_1.png'}
          alt="agent"
          className="size-5 object-contain"
          onError={e => {
            e.currentTarget.src = '/logo_1.png'
          }}
        />
      </div>
      {/* Dots */}
      <div className="flex items-center gap-1.5 py-1">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="size-2 rounded-full bg-[#a7e26e]/50"
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 1, 0.5] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: i * 0.18,
              ease: 'easeInOut'
            }}
          />
        ))}
      </div>
    </motion.div>
  )
}

export function ChatList({
  messages,
  isLoading,
  agentAvatarGradient,
  agentAvatarInitial,
  agentLogoUrl,
  handoffIndicatorPrefix = '__handoff_indicator__',
  variant = 'default',
  assistantLabel,
  userLabel,
  showMessageActions = true
}: ChatListProps) {
  if (!messages.length) {
    return null
  }

  return (
    <div
      className={
        variant === 'transcript'
          ? 'flex flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-6 sm:py-8'
          : 'flex flex-col gap-5 px-3 py-5 sm:gap-6 sm:px-5 sm:py-6'
      }
    >
      <AnimatePresence initial={false}>
        {messages.map((message, index) => {
          // Render handoff indicator for system messages with the handoff prefix
          if (
            message.role === 'system' &&
            message.id?.startsWith(handoffIndicatorPrefix)
          ) {
            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.28,
                  ease: [0.16, 1, 0.3, 1]
                }}
              >
                <ChatHandoffIndicator agentName={message.content} />
              </motion.div>
            )
          }

          // Skip system messages that aren't handoff indicators
          if (message.role === 'system') return null

          return (
            <motion.div
              key={message.id ?? index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.28,
                ease: [0.16, 1, 0.3, 1]
              }}
            >
              <ChatMessage
                message={message}
                agentAvatarGradient={agentAvatarGradient}
                agentAvatarInitial={agentAvatarInitial}
                agentLogoUrl={agentLogoUrl}
                isLastMessage={index === messages.length - 1}
                variant={variant}
                assistantLabel={assistantLabel}
                userLabel={userLabel}
                showMessageActions={showMessageActions}
              />
            </motion.div>
          )
        })}

        {/* Typing indicator */}
        {isLoading && <TypingIndicator key="typing" logoUrl={agentLogoUrl} />}
      </AnimatePresence>
    </div>
  )
}
