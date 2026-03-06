'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { type Message } from 'ai/react'
import { motion, AnimatePresence } from 'framer-motion'

import { type VibeAgent } from '@/lib/types'
import { AgentChat } from '@/components/agent-chat'
import { Button } from '@/components/ui/button'
import { IconCheck } from '@/components/ui/icons'
import { GoogleReviewButton } from '@/components/google-review-button'

interface PublicAgentExperienceProps {
  agent: VibeAgent
  googleReviewPlaceId?: string | null
}

export function PublicAgentExperience({
  agent,
  googleReviewPlaceId
}: PublicAgentExperienceProps) {
  const router = useRouter()
  const [showThankYou, setShowThankYou] = useState(false)
  const [completedMessages, setCompletedMessages] = useState<Message[]>([])

  const handleChatComplete = useCallback((messages?: Message[]) => {
    if (messages) setCompletedMessages(messages)
    setShowThankYou(true)
  }, [])

  const handleClose = useCallback(() => {
    router.push('/')
  }, [router])

  // Generate a consistent avatar gradient from agent name
  const avatarInitial = agent.name?.[0]?.toUpperCase() ?? 'A'
  const avatarColors = [
    'from-violet-400 to-purple-500',
    'from-blue-400 to-indigo-500',
    'from-emerald-400 to-teal-500',
    'from-rose-400 to-pink-500',
    'from-amber-400 to-orange-500'
  ]
  const colorIndex = (agent.name?.charCodeAt(0) ?? 0) % avatarColors.length
  const avatarGradient = avatarColors[colorIndex]

  return (
    <AnimatePresence mode="wait">
      {showThankYou ? (
        /* Thank-you screen — centered card */
        <motion.div
          key="thank-you"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-1 items-center justify-center bg-[#f7f7f5] p-6 dark:bg-[#222f30]"
        >
          <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 rounded-3xl border border-[#e4e3e3] bg-[#f5f8f7] p-10 text-center shadow-[0_8px_40px_rgba(0,0,0,0.10)] dark:border-[#344348] dark:bg-[#192425]">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{
                delay: 0.15,
                type: 'spring',
                stiffness: 260,
                damping: 20
              }}
              className="flex size-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30"
            >
              <IconCheck className="size-10 text-emerald-600 dark:text-emerald-400" />
            </motion.div>
            <div className="space-y-2">
              <h2 className="font-sans text-2xl font-medium tracking-tight text-[#222f30] dark:text-[#f5f8f7]">
                Thanks for vibing!
              </h2>
              <p className="text-sm leading-relaxed text-[#445e5f] dark:text-[#6f7f80]">
                {agent.mode === 'collector'
                  ? "We've collected your responses. You can close this page now."
                  : 'We hope you found what you were looking for!'}
              </p>
            </div>
            <div className="mt-2 flex flex-col items-center gap-3">
              {googleReviewPlaceId &&
                agent.mode === 'collector' &&
                completedMessages.length > 0 && (
                  <GoogleReviewButton
                    placeId={googleReviewPlaceId}
                    messages={completedMessages}
                  />
                )}
              <Button
                onClick={handleClose}
                size="lg"
                className="rounded-full px-10"
              >
                Done
              </Button>
            </div>
          </div>
        </motion.div>
      ) : (
        /* Chat — full-screen, Claude.ai style */
        <motion.div
          key="chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]"
        >
          {/* Agent header — full width, content centered */}
          <div className="shrink-0 border-b border-[#e4e3e3]/70 bg-[#f5f8f7]/80 backdrop-blur-sm dark:border-[#344348] dark:bg-[#192425]/80">
            <div className="mx-auto flex w-full max-w-[760px] items-center gap-3 px-4 py-3 sm:px-6">
              {/* Agent logo */}
              <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#e4e3e3] bg-[#f5f8f7] shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:border-[#344348] dark:bg-[#192425]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo_1.png"
                  alt="agent"
                  className="size-6 object-contain"
                />
              </div>

              {/* Agent name */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-[#222f30] dark:text-[#f5f8f7]">
                  {agent.name}
                </p>
              </div>

              {/* Online indicator */}
              <div className="flex items-center gap-1.5">
                <div className="size-2 rounded-full bg-primary shadow-[0_0_6px_rgba(167,226,110,0.6)]" />
                <span className="text-xs text-[#6f7f80]">Online</span>
              </div>
            </div>
          </div>

          {/* Chat body — fills all remaining space */}
          <AgentChat
            agent={agent}
            endpoint={`/api/public/agents/${agent.id}/chat`}
            onChatComplete={handleChatComplete}
            agentAvatarGradient={avatarGradient}
            agentAvatarInitial={avatarInitial}
            googleReviewPlaceId={googleReviewPlaceId}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
