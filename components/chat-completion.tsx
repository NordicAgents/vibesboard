'use client'

import { motion } from 'framer-motion'

import { type AgentMode } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { IconCheck, IconClose } from '@/components/ui/icons'

interface ChatCompletionProps {
  mode: AgentMode
  onComplete: () => void
  onCorrect?: () => void
  agentName?: string
}

export function ChatCompletion({
  mode,
  onComplete,
  onCorrect,
  agentName
}: ChatCompletionProps) {
  if (mode === 'collector') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-4 rounded-2xl border bg-gradient-to-b from-green-50 to-white p-6 text-center shadow-sm dark:from-green-950/20 dark:to-background"
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
          <IconCheck className="size-6 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Thanks for vibing!</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            We&apos;ve collected your response.
          </p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {onCorrect && (
            <Button
              onClick={onCorrect}
              variant="outline"
              className="rounded-full px-6"
              size="lg"
            >
              Correct an answer
            </Button>
          )}
          <Button
            onClick={onComplete}
            className="rounded-full px-6"
            size="lg"
          >
            Submit
          </Button>
        </div>
      </motion.div>
    )
  }

  // Provider mode
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-3 rounded-xl border bg-muted/50 p-4 text-center"
    >
      <p className="text-sm text-muted-foreground">
        Need anything else from {agentName || 'this agent'}?
      </p>
      <Button
        onClick={onComplete}
        variant="outline"
        className="rounded-full"
        size="sm"
      >
        <IconClose className="mr-2 size-4" />
        Close Chat
      </Button>
    </motion.div>
  )
}

interface ChatCompletionBannerProps {
  mode: AgentMode
  isAgentDisabled?: boolean
  onComplete: () => void
  onCorrect?: () => void
}

/**
 * Compact completion banner for the chat panel area
 */
export function ChatCompletionBanner({
  mode,
  isAgentDisabled,
  onComplete,
  onCorrect
}: ChatCompletionBannerProps) {
  if (isAgentDisabled) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center justify-center gap-3 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30"
      >
        <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
          This agent has reached its response limit and is no longer accepting conversations.
        </span>
      </motion.div>
    )
  }

  if (mode === 'collector') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex items-center justify-between gap-4 rounded-xl bg-green-50 px-4 py-3 dark:bg-green-950/30"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
            <IconCheck className="size-4 text-green-600 dark:text-green-400" />
          </div>
          <span className="text-sm font-medium">
            Thanks for vibing! We&apos;ve collected your response.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onCorrect && (
            <Button
              onClick={onCorrect}
              variant="outline"
              size="sm"
              className="rounded-full"
            >
              Correct an answer
            </Button>
          )}
          <Button onClick={onComplete} size="sm" className="rounded-full">
            Submit
          </Button>
        </div>
      </motion.div>
    )
  }

  // Provider mode
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center justify-center gap-3 rounded-xl bg-muted/80 px-4 py-3"
    >
      <span className="text-sm text-muted-foreground">All done?</span>
      <Button
        onClick={onComplete}
        variant="outline"
        size="sm"
        className="rounded-full"
      >
        <IconClose className="mr-2 size-3.5" />
        Close Chat
      </Button>
    </motion.div>
  )
}
