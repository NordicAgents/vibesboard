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

// Typing indicator dots
function TypingIndicator({
  agentAvatarGradient = 'from-violet-400 to-purple-500',
  agentAvatarInitial = 'A'
}: {
  agentAvatarGradient?: string
  agentAvatarInitial?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="flex items-end gap-2.5"
    >
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br ${agentAvatarGradient} text-xs font-semibold text-white shadow-sm`}
      >
        {agentAvatarInitial}
      </div>
      <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-border/40 bg-muted/50 px-4 py-3 shadow-sm dark:bg-muted/30">
        {[0, 1, 2].map(i => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"
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
    <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
      <AnimatePresence initial={false}>
        {messages.map((message, index) => (
          <motion.div
            key={message.id ?? index}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              duration: 0.25,
              ease: [0.16, 1, 0.3, 1],
              delay: 0
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
        {isLoading && (
          <TypingIndicator
            key="typing"
            agentAvatarGradient={agentAvatarGradient}
            agentAvatarInitial={agentAvatarInitial}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
