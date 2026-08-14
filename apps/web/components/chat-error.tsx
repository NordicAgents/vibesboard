'use client'

import { motion } from 'framer-motion'
import { AlertCircle, RotateCcw, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

/**
 * A failed turn, in the shape the chat UI needs to talk about it.
 *
 * `retryable` distinguishes "the request died, try again" from states where
 * retrying immediately is pointless (a monthly quota that resets, a rate
 * limit that needs a wait). The banner hides its retry button in the latter
 * case rather than inviting a click that will fail the same way.
 */
export interface ChatError {
  message: string
  retryable: boolean
}

/**
 * Maps a failed chat response to a message a visitor can act on.
 *
 * Every branch here corresponds to a real response the chat routes return —
 * see apps/web/lib/usage.ts (usage_limit_reached), the public chat route's
 * rate limiter (rate_limit_reached), and the shared 403/5xx paths. The
 * fallback is deliberately vague because an unrecognized failure should not
 * guess at a cause.
 */
export function chatErrorFromResponse(
  status: number,
  body: { error?: string; message?: string } | null
): ChatError {
  if (status === 429) {
    // Two very different conditions share this status.
    if (body?.error === 'usage_limit_reached') {
      return {
        message:
          body.message ??
          'This workspace has used all its messages for this month.',
        retryable: false
      }
    }
    return {
      message:
        body?.message ??
        'Too many messages too quickly. Wait a moment and try again.',
      retryable: false
    }
  }

  if (status === 401 || status === 403) {
    return {
      message:
        body?.message ?? 'You do not have access to this agent right now.',
      retryable: false
    }
  }

  if (status >= 500) {
    return {
      message: 'The agent could not respond just now. Please try again.',
      retryable: true
    }
  }

  return {
    message: body?.message ?? 'Something went wrong sending that message.',
    retryable: true
  }
}

interface ChatErrorBannerProps {
  error: ChatError
  onRetry?: () => void
  onDismiss?: () => void
}

/**
 * Shown in place of nothing at all. Before this existed, a failed turn just
 * dropped the typing indicator and left the conversation looking idle, with
 * no way to tell a dead request from a slow one.
 */
export function ChatErrorBanner({
  error,
  onRetry,
  onDismiss
}: ChatErrorBannerProps) {
  return (
    <motion.div
      role="alert"
      aria-live="assertive"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 dark:bg-amber-950/30"
    >
      <div className="flex min-w-0 items-center gap-3">
        <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 text-sm text-amber-800 dark:text-amber-300">
          {error.message}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {error.retryable && onRetry && (
          <Button
            onClick={onRetry}
            variant="outline"
            size="sm"
            className="rounded-full"
          >
            <RotateCcw className="mr-1.5 size-3" />
            Try again
          </Button>
        )}
        {onDismiss && (
          <Button
            onClick={onDismiss}
            variant="ghost"
            size="icon"
            className="size-7 rounded-full"
            aria-label="Dismiss error"
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </motion.div>
  )
}
