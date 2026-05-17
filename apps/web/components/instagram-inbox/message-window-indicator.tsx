'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Clock, AlertCircle } from 'lucide-react'

interface MessageWindowIndicatorProps {
  windowExpiresAt: string | null | undefined
}

function getTimeRemaining(expiresAt: string): {
  isOpen: boolean
  label: string
} {
  const diff = new Date(expiresAt).getTime() - Date.now()

  if (diff <= 0) {
    return { isOpen: false, label: 'Window closed' }
  }

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours > 0) {
    return { isOpen: true, label: `${hours}h ${minutes}m remaining` }
  }
  return { isOpen: true, label: `${minutes}m remaining` }
}

export function MessageWindowIndicator({
  windowExpiresAt
}: MessageWindowIndicatorProps) {
  const [state, setState] = useState(() =>
    windowExpiresAt
      ? getTimeRemaining(windowExpiresAt)
      : { isOpen: false, label: 'No messages' }
  )

  useEffect(() => {
    if (!windowExpiresAt) return

    const update = () => setState(getTimeRemaining(windowExpiresAt))
    update()

    const interval = setInterval(update, 30_000) // Update every 30s
    return () => clearInterval(interval)
  }, [windowExpiresAt])

  if (!windowExpiresAt) {
    return null
  }

  if (state.isOpen) {
    return (
      <Badge
        variant="secondary"
        className="gap-1 bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400"
      >
        <Clock className="size-3" />
        {state.label}
      </Badge>
    )
  }

  return (
    <Badge
      variant="secondary"
      className="gap-1 bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400"
    >
      <AlertCircle className="size-3" />
      {state.label}
    </Badge>
  )
}
