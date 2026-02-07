'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'

import { type VibeAgent } from '@/lib/types'
import { AgentChat } from '@/components/agent-chat'
import { Button } from '@/components/ui/button'
import { IconClose, IconCheck } from '@/components/ui/icons'

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" onClick={handleClose} title="Close">
          <IconClose className="mr-2" /> Close
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {showThankYou ? (
          <motion.div
            key="thank-you"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center gap-6 rounded-2xl border bg-gradient-to-b from-green-50 to-white p-8 text-center shadow-lg dark:from-green-950/20 dark:to-background"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <IconCheck className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold">Thanks for vibing!</h2>
              <p className="mt-2 text-muted-foreground">
                {agent.mode === 'collector'
                  ? "We've collected your responses. You can close this page now."
                  : 'We hope you found what you were looking for!'}
              </p>
            </div>
            <Button
              onClick={handleClose}
              size="lg"
              className="mt-2 rounded-full px-8"
            >
              Close
            </Button>
          </motion.div>
        ) : (
          <motion.div key="chat" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="rounded-2xl border bg-muted p-5 text-center shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-muted-foreground">
                Welcome
              </p>
              <h2 className="mt-2 text-2xl font-semibold">
                You&apos;re now vibing with {agent.name}
              </h2>
              {agent.mode === 'collector' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  This agent will collect some information from you
                </p>
              )}
            </div>
            <AgentChat
              agent={agent}
              endpoint={`/api/public/agents/${agent.agentUrl}/chat`}
              onChatComplete={handleChatComplete}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
