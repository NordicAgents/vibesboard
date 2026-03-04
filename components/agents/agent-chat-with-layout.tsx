'use client'

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  type AgentSharePayload,
  type VibeAgent,
  type VibeAgentConversation
} from '@/lib/types'
import { formatDate } from '@/lib/utils'
import { DashboardLayout } from '@/components/layouts/dashboard-layout'
import { useSecondarySidebarSetter } from '@/components/layouts/secondary-sidebar-context'
import {
  DashboardSidebar,
  DashboardSidebarSection,
  DashboardSidebarItem
} from '@/components/layouts/dashboard-sidebar'
import { useAgentPageShell } from '@/components/agents/agent-page-shell-context'
import { useSidebar } from '@/components/sidebar-context'
import { AgentRightbar } from '@/components/agents/agent-rightbar'
import { AgentAskChat } from '@/components/agents/agent-ask-chat'
import { ConversationView } from '@/components/agents/conversation-modal'
import { Button } from '@/components/ui/button'
import { IconRefresh, IconEdit, IconMessage } from '@/components/ui/icons'

const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi

const toConversationLabel = (value?: string | null) => {
  const cleaned = (value ?? '')
    .replace(UUID_PATTERN, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'Visitor conversation'
  if (cleaned.length <= 110) return cleaned

  const truncated = cleaned.slice(0, 110)
  const lastWordBoundary = truncated.lastIndexOf(' ')
  if (lastWordBoundary > 60) {
    return `${truncated.slice(0, lastWordBoundary)}…`
  }

  return `${truncated}…`
}

interface AgentChatWithLayoutProps {
  agent: VibeAgent
  ownerId: string
  ownerSessions: VibeAgentConversation[]
  visitorSessions: VibeAgentConversation[]
  hasUnsyncedConversations: boolean
  share: AgentSharePayload
  isConfigure?: boolean
  canEdit: boolean
}

export function AgentChatWithLayout({
  agent,
  ownerId,
  ownerSessions,
  visitorSessions,
  hasUnsyncedConversations,
  share,
  isConfigure,
  canEdit
}: AgentChatWithLayoutProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const agentPageShell = useAgentPageShell()
  const { isSidebarOpen, setIsSidebarOpen: setMainSidebarOpen } = useSidebar()
  const setSecondarySidebar = useSecondarySidebarSetter()

  const setAgentSidebarOpen = agentPageShell?.setIsSidebarOpen
  const wasConfiguringRef = React.useRef(false)

  // Sync sidebar (Configure vs Ask AI) with the URL
  React.useEffect(() => {
    if (!setAgentSidebarOpen) return
    setAgentSidebarOpen(Boolean(isConfigure) && canEdit)
  }, [isConfigure, setAgentSidebarOpen, canEdit])

  // Collapse main sidebar only on the transition into configure mode
  React.useEffect(() => {
    const isConfiguring = Boolean(agentPageShell?.isSidebarOpen)
    if (isConfiguring && !wasConfiguringRef.current) {
      setMainSidebarOpen(false)
    }
    wasConfiguringRef.current = isConfiguring
  }, [agentPageShell?.isSidebarOpen, setMainSidebarOpen])

  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
    () => {
      const sessionParam = searchParams.get('session')
      if (sessionParam && ownerSessions.find(s => s.id === sessionParam)) {
        return sessionParam
      }
      return ownerSessions[0]?.id ?? null
    }
  )
  const [selectedConversation, setSelectedConversation] =
    React.useState<VibeAgentConversation | null>(null)
  const [visitorPage, setVisitorPage] = React.useState(1)
  const [refreshingSummaries, setRefreshingSummaries] = React.useState(false)

  // Sync activeSessionId with URL
  React.useEffect(() => {
    const sessionParam = searchParams.get('session')
    if (sessionParam && sessionParam !== activeSessionId) {
      const found = ownerSessions.find(session => session.id === sessionParam)
      if (found) {
        setActiveSessionId(sessionParam)
      }
    } else if (!sessionParam && activeSessionId) {
      setActiveSessionId(null)
    }
  }, [searchParams, ownerSessions, activeSessionId])

  const handleSelectSession = React.useCallback(
    (sessionId: string | null) => {
      setActiveSessionId(sessionId)
      if (!canEdit) {
        if (sessionId) {
          router.push(`/agents/${agent.id}/conversations/${sessionId}`)
          return
        }
        router.push(`/agents/${agent.id}/conversations/new`)
        return
      }
      if (sessionId) {
        router.push(`/agents/${agent.id}?session=${sessionId}`)
        return
      }
      router.push(`/agents/${agent.id}`)
    },
    [agent.id, router, canEdit]
  )

  const handleOpenConversation = React.useCallback(
    (conversation: VibeAgentConversation) => {
      setSelectedConversation(conversation)
    },
    []
  )

  const handleNewChat = React.useCallback(() => {
    setActiveSessionId(null)
    if (!canEdit) {
      router.push(`/agents/${agent.id}/conversations/new`)
      return
    }
    router.push(`/agents/${agent.id}`)
  }, [agent.id, router, canEdit])

  const handleRefreshSummaries = React.useCallback(async () => {
    setRefreshingSummaries(true)
    try {
      await fetch(`/api/agents/${agent.id}/conversations/refresh-summaries`, {
        method: 'POST'
      })
      router.refresh()
    } finally {
      setRefreshingSummaries(false)
    }
  }, [agent.id, router])

  // Pagination for visitor conversations
  const itemsPerPage = 5
  const totalVisitorPages = Math.ceil(visitorSessions.length / itemsPerPage)
  const startIndex = (visitorPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedVisitorSessions = React.useMemo(
    () => visitorSessions.slice(startIndex, endIndex),
    [visitorSessions, startIndex, endIndex]
  )

  // Reset to page 1 if current page is out of bounds
  React.useEffect(() => {
    if (visitorPage > totalVisitorPages && totalVisitorPages > 0) {
      setVisitorPage(1)
    }
  }, [visitorPage, totalVisitorPages])

  const sidebar = React.useMemo(
    () => (
      <DashboardSidebar>
        {/* Agent Info */}
        <div className="mb-4 rounded-xl border border-[#E2DDD4] bg-[#EDE8DE]/40 p-4 dark:border-[#2E2B25] dark:bg-[#2E2B25]/40">
          <h3 className="truncate font-serif text-base font-normal text-[#1A1915] dark:text-[#E8E3D8]">
            {agent.name}
          </h3>
        </div>

        {!canEdit && (
          <div className="mb-4 rounded-lg border border-dashed border-[#E2DDD4] bg-[#EDE8DE]/30 px-4 py-3 text-sm text-[#6B6560] dark:border-[#2E2B25] dark:bg-[#2E2B25]/20 dark:text-[#9D9790]">
            Read-only (ask a tenant admin to edit)
          </div>
        )}

        {/* Navigation */}
        <div
          className={`mb-4 grid gap-2 ${canEdit ? 'grid-cols-2' : 'grid-cols-1'}`}
        >
          <Button
            variant={!agentPageShell?.isSidebarOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="justify-start gap-2 px-2"
            data-mobile-menu-close="true"
            onClick={() => {
              setSelectedConversation(null)
              if (!canEdit) {
                router.push(`/agents/${agent.id}/conversations/new`)
                return
              }
              setAgentSidebarOpen?.(false)
              const params = new URLSearchParams(searchParams.toString())
              params.delete('configure')
              const query = params.toString()
              router.push(
                query ? `/agents/${agent.id}?${query}` : `/agents/${agent.id}`
              )
            }}
          >
            <IconMessage className="size-4" />
            {canEdit ? 'Ask AI' : 'Chat'}
          </Button>
          {canEdit && (
            <Button
              variant={agentPageShell?.isSidebarOpen ? 'secondary' : 'ghost'}
              size="sm"
              className="justify-start gap-2 px-2"
              data-mobile-menu-close="true"
              onClick={() => {
                setSelectedConversation(null)
                setAgentSidebarOpen?.(true)
                const params = new URLSearchParams(searchParams.toString())
                params.set('configure', 'true')
                router.push(`/agents/${agent.id}?${params.toString()}`)
              }}
            >
              <IconEdit className="size-4" />
              Configure
            </Button>
          )}
        </div>

        {/* Visitor Chat History */}
        {canEdit && (
          <DashboardSidebarSection
            title="Visitor Chat History"
            action={
              <Button
                size="sm"
                variant="secondary"
                className="size-7 rounded-full p-0"
                onClick={handleRefreshSummaries}
                disabled={refreshingSummaries}
                title="Refresh summaries"
                aria-label="Refresh summaries"
              >
                <IconRefresh
                  className={
                    refreshingSummaries
                      ? 'size-3.5 animate-spin'
                      : 'size-3.5'
                  }
                />
              </Button>
            }
          >
            {visitorSessions.length === 0 && (
              <div className="rounded-lg border border-dashed border-[#E2DDD4] px-3 py-2 text-sm text-[#9D9790] dark:border-[#2E2B25]">
                No visitor chats yet.
              </div>
            )}
            {paginatedVisitorSessions.map(session => {
              const label = toConversationLabel(
                session.summary || session.messages.at(-1)?.content
              )

              return (
                <DashboardSidebarItem
                  key={session.id}
                  className="bg-[#FDFAF5] dark:bg-[#221F1A]"
                  onClick={() => handleOpenConversation(session)}
                >
                  <div className="truncate font-medium" title={label}>
                    {label}
                  </div>
                  <div className="text-[11px] text-gray-secondary">
                    Updated {formatDate(session.updatedAt)}
                  </div>
                </DashboardSidebarItem>
              )
            })}
            {visitorSessions.length > itemsPerPage && (
              <div className="flex items-center justify-between gap-2 pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setVisitorPage(prev => Math.max(1, prev - 1))}
                  disabled={visitorPage === 1}
                  className="h-7 rounded-full px-3 font-switzer text-[11px]"
                >
                  Previous
                </Button>
                <span className="font-switzer text-[11px] text-gray-secondary">
                  Page {visitorPage} of {totalVisitorPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setVisitorPage(prev =>
                      Math.min(totalVisitorPages, prev + 1)
                    )
                  }
                  disabled={visitorPage === totalVisitorPages}
                  className="h-7 rounded-full px-3 font-switzer text-[11px]"
                >
                  Next
                </Button>
              </div>
            )}
          </DashboardSidebarSection>
        )}

        {/* Conversations */}
        <DashboardSidebarSection
          title="My Chat History"
          action={
            <button
              onClick={handleNewChat}
              data-mobile-menu-close="true"
              className="flex size-5 items-center justify-center rounded text-xs text-[#9D9790] transition-colors hover:text-[#1A1915] dark:hover:text-[#E8E3D8]"
              aria-label="New conversation"
            >
              +
            </button>
          }
        >
          {ownerSessions.slice(0, 10).map(session => (
            <DashboardSidebarItem
              key={session.id}
              active={activeSessionId === session.id}
              onClick={() => handleSelectSession(session.id)}
            >
              <div className="truncate">
                {session.summary || 'Untitled conversation'}
              </div>
            </DashboardSidebarItem>
          ))}
        </DashboardSidebarSection>
      </DashboardSidebar>
    ),
    [
      activeSessionId,
      agent.name,
      agentPageShell?.isSidebarOpen,
      agentPageShell?.setIsSidebarOpen,
      canEdit,
      handleNewChat,
      handleOpenConversation,
      handleRefreshSummaries,
      handleSelectSession,
      ownerSessions,
      paginatedVisitorSessions,
      refreshingSummaries,
      totalVisitorPages,
      visitorPage,
      visitorSessions.length
    ]
  )

  React.useEffect(() => {
    setSecondarySidebar(sidebar)
    return () => {
      setSecondarySidebar(null)
    }
  }, [setSecondarySidebar, sidebar])

  return (
    <DashboardLayout sidebar={!isSidebarOpen ? sidebar : undefined}>
      {selectedConversation ? (
        <div className="h-full bg-[#F5F0E8] dark:bg-[#1A1915]">
          <ConversationView
            conversation={selectedConversation}
            onClose={() => setSelectedConversation(null)}
          />
        </div>
      ) : agentPageShell?.isSidebarOpen && canEdit ? (
        <div className="h-full overflow-y-auto bg-[#F5F0E8] p-4 dark:bg-[#1A1915]">
          <AgentRightbar
            agent={agent}
            share={share}
            conversations={visitorSessions}
            className="mx-auto w-full max-w-5xl"
            onClose={() => agentPageShell.setIsSidebarOpen(false)}
            canEdit={canEdit}
          />
        </div>
      ) : canEdit ? (
        <AgentAskChat
          agent={agent}
          ownerId={ownerId}
          ownerSessions={ownerSessions}
        />
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
          <div className="rounded-xl border border-[#E2DDD4] bg-[#FDFAF5] p-6 dark:border-[#2E2B25] dark:bg-[#221F1A]">
            <h1 className="font-serif text-xl font-normal text-[#1A1915] dark:text-[#E8E3D8]">Read-only access</h1>
            <p className="mt-2 text-sm text-[#6B6560] dark:text-[#9D9790]">
              Analytics and configuration are available to the agent owner and
              tenant admins.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                onClick={() => {
                  if (activeSessionId) {
                    router.push(
                      `/agents/${agent.id}/conversations/${activeSessionId}`
                    )
                    return
                  }
                  router.push(`/agents/${agent.id}/conversations/new`)
                }}
              >
                Open chat
              </Button>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  )
}
