'use client'

import { type Message } from 'ai'
import { motion, AnimatePresence } from 'framer-motion'

import { ChatMessage } from '@/components/chat-message'

export interface ChatListProps {
  messages: Message[]
  isLoading?: boolean
  agentAvatarGradient?: string
  agentAvatarInitial?: string
}

// Typing indicator — warm dots
function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex items-end gap-3"
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#E2DDD4] bg-[#FDFAF5] shadow-[0_1px_3px_rgba(26,25,21,0.06)] dark:border-[#2E2B25] dark:bg-[#221F1A]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_1.png" alt="agent" className="h-5 w-5 object-contain" />
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-[#E2DDD4] bg-[#FDFAF5] px-4 py-3 shadow-[0_1px_3px_rgba(26,25,21,0.06)] dark:border-[#2E2B25] dark:bg-[#221F1A]">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-[#D97757]/60"
            animate={{ y: [0, -4, 0] }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: i * 0.15,
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
  agentAvatarInitial
}: ChatListProps) {
  if (!messages.length) {
    return null
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      <AnimatePresence initial={false}>
        {messages.map((message, index) => (
          <motion.div
            key={message.id ?? index}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.25,
              ease: [0.16, 1, 0.3, 1],
            }}
          >
            <ChatMessage
              message={message}
              agentAvatarGradient={agentAvatarGradient}
              agentAvatarInitial={agentAvatarInitial}
              isLastMessage={index === messages.length - 1}
            />
          </motion.div>
        ))}

        {/* Typing indicator */}
        {isLoading && <TypingIndicator key="typing" />}
      </AnimatePresence>
    </div>
  )
}
