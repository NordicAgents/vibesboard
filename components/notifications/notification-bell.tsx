'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCircle2, ArrowRightCircle, ArrowRightLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import type { NotificationDocument } from '@/lib/firestore-types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  tenantId: string
}

const POLL_INTERVAL = 30_000

export function NotificationBell({ tenantId }: Props) {
  const router = useRouter()
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<NotificationDocument[]>([])
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Poll unread count
  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/count')
      if (res.ok) {
        const data = await res.json()
        setUnreadCount(data.count ?? 0)
      }
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    fetchCount()
    const interval = setInterval(fetchCount, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchCount])

  // Fetch notifications when dropdown opens
  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?limit=20')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications ?? [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  const handleToggle = () => {
    const next = !isOpen
    setIsOpen(next)
    if (next) {
      fetchNotifications()
    }
  }

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter(n => !n.read).map(n => n.id)
    if (!unreadIds.length) return

    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unreadIds })
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      await fetchCount()
    } catch {
      // ignore
    }
  }

  const handleClickNotification = (notification: NotificationDocument) => {
    setIsOpen(false)
    if (!notification.read) {
      fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [notification.id] })
      }).catch(() => {})
      setNotifications(prev =>
        prev.map(n => (n.id === notification.id ? { ...n, read: true } : n))
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    }
    router.push(
      `/agents/${notification.agentId}/conversations/${notification.conversationId}`
    )
  }

  const timeAgo = (isoDate: string) => {
    const seconds = Math.floor(
      (Date.now() - new Date(isoDate).getTime()) / 1000
    )
    if (seconds < 60) return 'just now'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={handleToggle}
        className="relative flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Notifications"
      >
        <Bell className="size-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex size-4 items-center justify-center rounded-full bg-accent-orange text-[10px] font-bold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border bg-surface shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-medium">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No notifications
              </div>
            ) : (
              notifications.map(notification => (
                <button
                  key={notification.id}
                  onClick={() => handleClickNotification(notification)}
                  className={cn(
                    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover',
                    !notification.read && 'bg-accent-orange/5'
                  )}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    {notification.event === 'handoff' ? (
                      <ArrowRightCircle className="size-4 text-amber-500" />
                    ) : notification.event === 'agent_handoff' ? (
                      <ArrowRightLeft className="size-4 text-blue-500" />
                    ) : (
                      <CheckCircle2 className="size-4 text-green-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium">
                        {notification.agentName}
                      </p>
                      {!notification.read && (
                        <span className="size-1.5 flex-shrink-0 rounded-full bg-accent-orange" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {notification.event === 'handoff'
                        ? 'Needs human handoff'
                        : notification.event === 'agent_handoff'
                          ? 'Transferred to another agent'
                          : 'Conversation completed'}
                    </p>
                    {notification.summary && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {notification.summary}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-muted-foreground/60">
                      {timeAgo(notification.createdAt)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
