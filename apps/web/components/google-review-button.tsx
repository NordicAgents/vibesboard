'use client'

import { useCallback } from 'react'
import { type Message } from '@vibesboard/contracts'
import toast from 'react-hot-toast'

import { Button } from '@/components/ui/button'
import { useCopyToClipboard } from '@/lib/hooks/use-copy-to-clipboard'

// Words that are too trivial to include in a review
const TRIVIAL_PATTERNS =
  /^(hi|hello|hey|yes|yeah|yep|no|nope|ok|okay|sure|thanks|thank you|bye|goodbye)\s*[.!?]*$/i

interface GoogleReviewButtonProps {
  placeId: string
  messages: Message[]
}

export function GoogleReviewButton({
  placeId,
  messages
}: GoogleReviewButtonProps) {
  const { copyToClipboard } = useCopyToClipboard({ timeout: 3000 })

  const handleClick = useCallback(() => {
    // Extract meaningful user messages
    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => m.content.trim())
      .filter(text => text.length > 0 && !TRIVIAL_PATTERNS.test(text))

    const feedbackText = userMessages.join('\n\n')

    if (feedbackText) {
      copyToClipboard(feedbackText)
      toast.success('Feedback copied! Paste it in Google Reviews')
    }

    window.open(
      `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`,
      '_blank',
      'noopener,noreferrer'
    )
  }, [placeId, messages, copyToClipboard])

  return (
    <Button
      onClick={handleClick}
      variant="outline"
      size="sm"
      className="gap-2 rounded-full border-[#e4e3e3] bg-white hover:bg-[#e6ede6] dark:border-[#344348] dark:bg-[#192425] dark:hover:bg-[#344348]"
    >
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
      Share on Google
    </Button>
  )
}
