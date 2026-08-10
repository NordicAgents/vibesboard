'use client'

import { useCallback, useEffect, useState } from 'react'
import { type Message } from '@vibesboard/contracts'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard'

// Words that are too trivial to include in a review
const TRIVIAL_PATTERNS =
  /^(hi|hello|hey|yes|yeah|yep|no|nope|ok|okay|sure|thanks|thank you|bye|goodbye)\s*[.!?]*$/i

interface GoogleReviewCardProps {
  agentId: string
  placeId: string
  messages: Message[]
  onShare?: () => void
}

export function GoogleReviewCard({
  agentId,
  placeId,
  messages,
  onShare
}: GoogleReviewCardProps) {
  const [reviewText, setReviewText] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(true)
  const [error, setError] = useState(false)
  const { isCopied, copyToClipboard } = useCopyToClipboard({ timeout: 3000 })

  useEffect(() => {
    let cancelled = false

    async function generateReview() {
      try {
        const res = await fetch(
          `/api/public/agents/${agentId}/generate-review`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: messages.map(m => ({
                role: m.role,
                content: m.content
              }))
            })
          }
        )

        if (!res.ok) throw new Error('Failed to generate')

        const data = await res.json()

        if (!cancelled && data.review) {
          setReviewText(data.review)
        } else if (!cancelled) {
          setError(true)
        }
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setIsGenerating(false)
      }
    }

    generateReview()
    return () => {
      cancelled = true
    }
  }, [agentId, messages])

  const handleCopyAndShare = useCallback(() => {
    const textToCopy = reviewText || getFallbackText(messages)

    if (textToCopy) {
      copyToClipboard(textToCopy)
      toast.success('Review copied! Paste it in Google Reviews')
    }

    window.open(
      `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
      '_blank',
      'noopener,noreferrer'
    )

    onShare?.()
  }, [reviewText, messages, placeId, copyToClipboard, onShare])

  // Loading state
  if (isGenerating) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="rounded-2xl border border-[#e4e3e3] bg-white p-5 dark:border-[#344348] dark:bg-[#192425]">
          <div className="flex items-center gap-3">
            <div className="skeleton h-4 w-4 rounded-full" />
            <span className="text-sm text-[#6f7f80]">
              Preparing your review...
            </span>
          </div>
          <div className="mt-3 space-y-2">
            <div className="skeleton h-3 w-full rounded" />
            <div className="skeleton h-3 w-4/5 rounded" />
            <div className="skeleton h-3 w-3/5 rounded" />
          </div>
        </div>
      </motion.div>
    )
  }

  // Error fallback — just show the simple button (same as old behavior)
  if (error && !reviewText) {
    return (
      <Button
        onClick={handleCopyAndShare}
        variant="outline"
        size="sm"
        className="gap-2 rounded-full border-[#e4e3e3] bg-white hover:bg-[#e6ede6] dark:border-[#344348] dark:bg-[#192425] dark:hover:bg-[#344348]"
      >
        <GoogleIcon />
        Share on Google
      </Button>
    )
  }

  // Success state — show generated review
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="w-full max-w-sm"
    >
      <div className="rounded-2xl border border-[#e4e3e3] bg-white p-5 dark:border-[#344348] dark:bg-[#192425]">
        <p className="mb-3 text-xs font-medium text-[#6f7f80]">
          Your review is ready
        </p>
        <textarea
          value={reviewText ?? ''}
          onChange={e => setReviewText(e.target.value)}
          rows={4}
          className="w-full resize-y rounded-xl border border-[#e4e3e3] bg-[#f5f8f7] p-3 text-sm leading-relaxed text-[#222f30] outline-none transition-colors focus:border-[#D97757] focus:ring-1 focus:ring-[#D97757]/30 dark:border-[#344348] dark:bg-[#222f30] dark:text-[#f5f8f7] dark:focus:border-[#D97757]"
        />
        <Button
          onClick={handleCopyAndShare}
          className="mt-3 w-full gap-2 rounded-full"
          size="sm"
        >
          <GoogleIcon />
          {isCopied ? 'Copied! Opening Google...' : 'Copy & Share on Google'}
        </Button>
      </div>
    </motion.div>
  )
}

function getFallbackText(messages: Message[]): string {
  return messages
    .filter(m => m.role === 'user')
    .map(m => m.content.trim())
    .filter(text => text.length > 0 && !TRIVIAL_PATTERNS.test(text))
    .join('\n\n')
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}
