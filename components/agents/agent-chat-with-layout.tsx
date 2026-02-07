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
import { ConversationModal } from '@/components/agents/conversation-modal'
import { Button } from '@/components/ui/button'
import { IconRefresh, IconEdit, IconMessage } from '@/components/ui/icons'

interface AgentChatWithLayoutProps {
  agent: VibeAgent
  ownerId: string
  ownerSessions: VibeAgentConversation[]
  visitorSessions: VibeAgentConversation[]
  hasUnsyncedConversations: boolean
  share: AgentSharePayload
  isConfigure?: boolean
}

export function AgentChatWithLayout({
  agent,
  ownerId,
  ownerSessions,
  visitorSessions,
  hasUnsyncedConversations,
  share,
  isConfigure
}: AgentChatWithLayoutProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const agentPageShell = useAgentPageShell()
  const { isSidebarOpen } = useSidebar()
  const setSecondarySidebar = useSecondarySidebarSetter()

  const setAgentSidebarOpen = agentPageShell?.setIsSidebarOpen

  // Sync sidebar (Configure vs Ask AI) with the URL
  React.useEffect(() => {
    if (!setAgentSidebarOpen) return
    setAgentSidebarOpen(Boolean(isConfigure))
  }, [isConfigure, setAgentSidebarOpen])

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
  const [isModalOpen, setIsModalOpen] = React.useState(false)
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
      if (sessionId) {
        router.push(`/agents/${agent.id}?session=${sessionId}`)
        return
      }
      router.push(`/agents/${agent.id}`)
    },
    [agent.id, router]
  )

  const handleOpenConversation = React.useCallback(
    (conversation: VibeAgentConversation) => {
      setSelectedConversation(conversation)
      setIsModalOpen(true)
    },
    []
  )

  const handleNewChat = React.useCallback(() => {
    setActiveSessionId(null)
    router.push(`/agents/${agent.id}`)
  }, [agent.id, router])

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
      <div className="mb-4 rounded-2xl border border-black-10 bg-beige-bg/30 p-4 dark:bg-background/30 dark:border-border">
        <h3 className="truncate font-switzer text-lg font-bold text-black-primary dark:text-foreground">
          {agent.name}
        </h3>
      </div>

      {/* Navigation */}
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Button
          variant={!agentPageShell?.isSidebarOpen ? 'secondary' : 'ghost'}
          size="sm"
          className="justify-start gap-2 px-2"
          data-mobile-menu-close="true"
          onClick={() => {
            setAgentSidebarOpen?.(false)
            const params = new URLSearchParams(searchParams.toString())
            params.delete('configure')
            const query = params.toString()
            router.push(query ? `/agents/${agent.id}?${query}` : `/agents/${agent.id}`)
          }}
        >
          <IconMessage className="h-4 w-4" />
          Ask AI
        </Button>
        <Button
          variant={agentPageShell?.isSidebarOpen ? 'secondary' : 'ghost'}
          size="sm"
          className="justify-start gap-2 px-2"
          data-mobile-menu-close="true"
          onClick={() => {
            setAgentSidebarOpen?.(true)
            const params = new URLSearchParams(searchParams.toString())
            params.set('configure', 'true')
            router.push(`/agents/${agent.id}?${params.toString()}`)
          }}
        >
          <IconEdit className="h-4 w-4" />
          Configure
        </Button>
      </div>

      {/* Visitor Chat History */}
      <DashboardSidebarSection
        title="Visitor Chat History"
        action={
          <Button
            size="sm"
            variant="secondary"
            className="h-7 w-7 rounded-full p-0"
            onClick={handleRefreshSummaries}
            disabled={refreshingSummaries}
            title="Refresh summaries"
            aria-label="Refresh summaries"
          >
            <IconRefresh
              className={
                refreshingSummaries ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'
              }
            />
          </Button>
        }
      >
        {visitorSessions.length === 0 && (
          <div className="rounded-2xl border border-dashed border-black-10 px-3 py-2 text-sm text-gray-secondary dark:border-border">
            No visitor chats yet.
          </div>
        )}
        {paginatedVisitorSessions.map(session => (
          <DashboardSidebarItem
            key={session.id}
            className="bg-purewhite-bg dark:bg-background"
            onClick={() => handleOpenConversation(session)}
          >
            <div className="truncate font-medium">
              {session.summary ||
                session.messages.at(-1)?.content ||
                'Visitor conversation'}
            </div>
            <div className="text-[11px] text-gray-secondary">
              Updated {formatDate(session.updatedAt)}
            </div>
          </DashboardSidebarItem>
        ))}
        {visitorSessions.length > itemsPerPage && (
          <div className="flex items-center justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVisitorPage(prev => Math.max(1, prev - 1))}
              disabled={visitorPage === 1}
              className="h-7 rounded-full px-3 text-[11px] font-switzer"
            >
              Previous
            </Button>
            <span className="text-[11px] text-gray-secondary font-switzer">
              Page {visitorPage} of {totalVisitorPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setVisitorPage(prev => Math.min(totalVisitorPages, prev + 1))
              }
              disabled={visitorPage === totalVisitorPages}
              className="h-7 rounded-full px-3 text-[11px] font-switzer"
            >
              Next
            </Button>
          </div>
        )}
      </DashboardSidebarSection>

      {/* Conversations */}
      <DashboardSidebarSection
        title="My Chat History"
        action={
          <button
            onClick={handleNewChat}
            data-mobile-menu-close="true"
            className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-secondary transition-colors hover:text-black-primary dark:hover:text-foreground"
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
    <>
      <DashboardLayout sidebar={!isSidebarOpen ? sidebar : undefined}>
        {agentPageShell?.isSidebarOpen ? (
          <div className="h-full overflow-y-auto bg-background p-4">
            <AgentRightbar
              agent={agent}
              share={share}
              conversations={visitorSessions}
              className="mx-auto w-full max-w-5xl"
              onClose={() => agentPageShell.setIsSidebarOpen(false)}
            />
          </div>
        ) : (
          <AgentAskChat
            agent={agent}
            ownerId={ownerId}
            ownerSessions={ownerSessions}
          />
        )}
      </DashboardLayout>
      <ConversationModal
        conversation={selectedConversation}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
      />
    </>
  )
}
