'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

import { type VibeAgent } from '@/lib/types'
import { AgentChat } from '@/components/agent-chat'
import { Button } from '@/components/ui/button'
import { IconCheck } from '@/components/ui/icons'

interface PublicAgentExperienceProps {
  agent: VibeAgent
}

export function PublicAgentExperience({ agent }: PublicAgentExperienceProps) {
  const router = useRouter()
  const [showThankYou, setShowThankYou] = useState(false)

  const handleChatComplete = useCallback(() => {
    setShowThankYou(true)
  }, [])

  const handleClose = useCallback(() => {
    router.push('/')
  }, [router])

  // Generate a consistent avatar color from agent name
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
        <motion.div
          key="thank-you"
          initial={{ opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto flex w-full max-w-lg flex-col items-center gap-6 rounded-3xl border border-border/50 bg-gradient-to-b from-emerald-50/80 to-white p-10 text-center shadow-xl shadow-black/5 dark:from-emerald-950/20 dark:to-background dark:shadow-black/20"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              delay: 0.15,
              type: 'spring',
              stiffness: 260,
              damping: 20
            }}
            className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/30"
          >
            <IconCheck className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
          </motion.div>
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">
              Thanks for vibing!
            </h2>
            <p className="text-base text-muted-foreground">
              {agent.mode === 'collector'
                ? "We've collected your responses. You can close this page now."
                : 'We hope you found what you were looking for!'}
            </p>
          </div>
          <Button
            onClick={handleClose}
            size="lg"
            className="mt-2 rounded-full px-10 text-base font-medium"
          >
            Done
          </Button>
        </motion.div>
      ) : (
        <motion.div
          key="chat"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto flex w-full max-w-2xl flex-1 flex-col overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl shadow-black/8 sm:max-h-[740px] sm:rounded-3xl dark:shadow-black/30"
        >
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3 border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-sm sm:px-5">
            {/* Logo avatar */}
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background shadow-sm border border-border/50 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo_1.png"
                alt="vibesboard"
                className="h-7 w-7 object-contain"
              />
            </div>

            {/* Agent info */}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight">
                {agent.name}
              </p>
            </div>
          </div>

          {/* Chat body */}
          <AgentChat
            agent={agent}
            endpoint={`/api/public/agents/${agent.id}/chat`}
            onChatComplete={handleChatComplete}
            agentAvatarGradient={avatarGradient}
            agentAvatarInitial={avatarInitial}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
