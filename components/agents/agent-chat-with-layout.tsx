'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { type AgentSharePayload, type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { getDisplayTools } from '@/lib/agents/tooling'
import { formatDate } from '@/lib/utils'
import { DashboardLayout } from '@/components/layouts/dashboard-layout'
import {
  DashboardSidebar,
  DashboardSidebarSection,
  DashboardSidebarItem
} from '@/components/layouts/dashboard-sidebar'
import { DashboardPanel, DashboardPanelSection } from '@/components/layouts/dashboard-panel'
import { AgentAskChat } from '@/components/agents/agent-ask-chat'
import { ConversationModal } from '@/components/agents/conversation-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconExternalLink, IconFile } from '@/components/ui/icons'
import { QrCode } from '@/components/qr-code'

interface AgentChatWithLayoutProps {
    agent: VibeAgent
    ownerId: string
    ownerSessions: VibeAgentConversation[]
    visitorSessions: VibeAgentConversation[]
    hasUnsyncedConversations: boolean
    share: AgentSharePayload
}

export function AgentChatWithLayout({
    agent,
    ownerId,
    ownerSessions,
    visitorSessions,
    hasUnsyncedConversations,
    share
}: AgentChatWithLayoutProps) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const [activeSessionId, setActiveSessionId] = React.useState<string | null>(() => {
        const sessionParam = searchParams.get('session')
        if (sessionParam && ownerSessions.find(s => s.id === sessionParam)) {
            return sessionParam
        }
        return ownerSessions[0]?.id ?? null
    })
    const [selectedConversation, setSelectedConversation] = React.useState<VibeAgentConversation | null>(null)
    const [isModalOpen, setIsModalOpen] = React.useState(false)
    const [visitorPage, setVisitorPage] = React.useState(1)
    const [refreshingSummaries, setRefreshingSummaries] = React.useState(false)
    const [syncingEmbeddings, setSyncingEmbeddings] = React.useState(false)
    const [closingId, setClosingId] = React.useState<string | null>(null)

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

    const handleSelectSession = (sessionId: string | null) => {
        setActiveSessionId(sessionId)
        if (sessionId) {
            router.push(`/agents/${agent.id}?session=${sessionId}`)
        } else {
            router.push(`/agents/${agent.id}`)
        }
    }

    const handleOpenConversation = (conversation: VibeAgentConversation) => {
        setSelectedConversation(conversation)
        setIsModalOpen(true)
    }

    const handleNewChat = () => {
        setActiveSessionId(null)
        router.push(`/agents/${agent.id}`)
    }

    const handleRefreshSummaries = async () => {
        setRefreshingSummaries(true)
        try {
            await fetch(`/api/agents/${agent.id}/conversations/refresh-summaries`, {
                method: 'POST'
            })
            router.refresh()
        } finally {
            setRefreshingSummaries(false)
        }
    }

    const handleSyncEmbeddings = async () => {
        if (syncingEmbeddings || !hasUnsyncedConversations) {
            return
        }
        setSyncingEmbeddings(true)
        try {
            await fetch(`/api/agents/${agent.id}/conversations/sync-embeddings`, {
                method: 'POST'
            })
            router.refresh()
        } finally {
            setSyncingEmbeddings(false)
        }
    }

    const handleCloseConversation = async (conversationId: string) => {
        setClosingId(conversationId)
        try {
            await fetch(`/api/agents/${agent.id}/conversations/${conversationId}/close`, {
                method: 'POST'
            })
            router.refresh()
        } finally {
            setClosingId(null)
        }
    }

    const lastConversationAt = ownerSessions[0]?.updatedAt
    const displayTools = getDisplayTools(agent.tools)
    const [copiedShare, setCopiedShare] = React.useState(false)

    // Pagination for visitor conversations
    const itemsPerPage = 5
    const totalVisitorPages = Math.ceil(visitorSessions.length / itemsPerPage)
    const startIndex = (visitorPage - 1) * itemsPerPage
    const endIndex = startIndex + itemsPerPage
    const paginatedVisitorSessions = visitorSessions.slice(startIndex, endIndex)

    // Reset to page 1 if current page is out of bounds
    React.useEffect(() => {
        if (visitorPage > totalVisitorPages && totalVisitorPages > 0) {
            setVisitorPage(1)
        }
    }, [visitorPage, totalVisitorPages])

    const handleCopyShare = async () => {
        try {
            await navigator.clipboard?.writeText(share.url)
            setCopiedShare(true)
            setTimeout(() => setCopiedShare(false), 1200)
        } catch {
            // noop
        }
    }

    const sidebar = (
        <DashboardSidebar>
            {/* Agent Info */}
            <div className="mb-4 rounded-2xl border border-black-10 bg-beige-bg/30 p-4 dark:bg-background/30 dark:border-border">
                <h3 className="font-switzer text-lg font-bold text-black-primary dark:text-foreground">
                    {agent.name}
                </h3>
            </div>

            {/* Visitor conversations */}
            <DashboardSidebarSection
                title="Visitor conversations"
                action={
                    <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 rounded-full px-3 text-[11px] font-switzer"
                        onClick={handleRefreshSummaries}
                        disabled={refreshingSummaries}
                    >
                        {refreshingSummaries ? 'Refreshing...' : 'Refresh summaries'}
                    </Button>
                }
            >
                {visitorSessions.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-black-10 px-3 py-2 text-sm text-gray-secondary dark:border-border">
                        No visitor chats yet.
                    </div>
                )}
                {paginatedVisitorSessions.map((session) => (
                    <DashboardSidebarItem
                        key={session.id}
                        className="bg-purewhite-bg dark:bg-background"
                        onClick={() => handleOpenConversation(session)}
                    >
                        <div className="truncate font-medium">
                            {session.summary || session.messages.at(-1)?.content || 'Visitor conversation'}
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
                            onClick={() => setVisitorPage(prev => Math.min(totalVisitorPages, prev + 1))}
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
                        className="flex h-5 w-5 items-center justify-center rounded text-xs text-gray-secondary transition-colors hover:text-black-primary dark:hover:text-foreground"
                        aria-label="New conversation"
                    >
                        +
                    </button>
                }
            >
                {ownerSessions.slice(0, 10).map((session) => (
                    <DashboardSidebarItem
                        key={session.id}
                        active={activeSessionId === session.id}
                        onClick={() => handleSelectSession(session.id)}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <div className="truncate">
                                {session.summary || 'Untitled conversation'}
                            </div>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[11px]"
                                disabled={closingId === session.id}
                                onClick={(event) => {
                                    event.stopPropagation()
                                    handleCloseConversation(session.id)
                                }}
                            >
                                {closingId === session.id ? 'Closing' : 'Close'}
                            </Button>
                        </div>
                    </DashboardSidebarItem>
                ))}
            </DashboardSidebarSection>
        </DashboardSidebar>
    )

    const rightPanel = (
        <DashboardPanel title="Agent Details">
            {/* Overview */}
            <DashboardPanelSection
                title="Overview"
                description="Key info about how this agent is configured."
            >
                <div className="rounded-2xl border border-black-10 bg-beige-bg/30 p-3 font-switzer text-xs text-black-primary dark:border-border dark:bg-background/30 dark:text-foreground">
                    <div className="flex flex-wrap gap-x-6 gap-y-3">
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-secondary">
                                Visibility
                            </p>
                            <p className="mt-0.5">
                                {agent.allowAnonymous
                                    ? 'Public – anonymous chat allowed'
                                    : 'Public – sign in required'}
                            </p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-secondary">
                                Created
                            </p>
                            <p className="mt-0.5">{formatDate(agent.createdAt)}</p>
                        </div>
                        <div>
                            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-secondary">
                                Last updated
                            </p>
                            <p className="mt-0.5">
                                {formatDate(lastConversationAt ?? agent.updatedAt)}
                            </p>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-2xl bg-background px-3 py-2 text-xs dark:bg-muted">
                        <div className="min-w-0">
                            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-gray-secondary">
                                Public link
                            </p>
                            <p className="truncate text-black-primary dark:text-foreground">
                                /a/{agent.agentUrl}
                            </p>
                        </div>
                        <Link
                            href={`/a/${agent.agentUrl}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-black-10 text-gray-secondary transition-colors hover:text-black-primary dark:border-border dark:hover:text-foreground"
                        >
                            <IconExternalLink className="h-4 w-4" />
                        </Link>
                    </div>
                </div>
            </DashboardPanelSection>

            {/* Share & QR */}
            <DashboardPanelSection
                title="Share"
                description="Share this agent via link or QR code."
            >
                <div className="space-y-3">
                    <div className="flex items-center gap-2 rounded-2xl border border-black-10 bg-beige-bg/30 p-3 text-xs font-switzer text-black-primary dark:border-border dark:bg-background/30 dark:text-foreground">
                        <span className="truncate">{share.url}</span>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 rounded-full px-3 text-[11px]"
                            onClick={handleCopyShare}
                        >
                            {copiedShare ? 'Copied' : 'Copy'}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 rounded-full p-0"
                            asChild
                        >
                            <Link href={share.url} target="_blank" rel="noopener noreferrer">
                                <IconExternalLink className="h-3.5 w-3.5" />
                            </Link>
                        </Button>
                    </div>
                    <div className="flex items-center justify-center">
                        <QrCode dataUrl={share.qrDataUrl} size={140} />
                    </div>
                </div>
            </DashboardPanelSection>

            {/* Tools Section */}
            <DashboardPanelSection
                title="Tools"
                description={displayTools.length > 0 ? `${displayTools.length} enabled` : 'None enabled'}
            >
                {displayTools.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {displayTools.map((tool) => (
                            <Badge key={tool.id} variant="secondary" className="font-switzer text-xs">
                                {tool.name}
                            </Badge>
                        ))}
                    </div>
                )}
            </DashboardPanelSection>

            {/* Files Section */}
            <DashboardPanelSection
                title="Reference Files"
                description={agent.fileKeys.length > 0 ? `${agent.fileKeys.length} uploaded` : 'None uploaded'}
            >
                {agent.fileKeys.length > 0 && (
                    <div className="space-y-2">
                        {agent.fileKeys.slice(0, 5).map((key) => (
                            <div
                                key={key}
                                className="flex items-center gap-2 rounded-2xl border border-black-10 bg-beige-bg/30 p-2 dark:bg-background/30 dark:border-border"
                            >
                                <IconFile className="h-4 w-4 flex-shrink-0 text-gray-secondary" />
                                <span className="truncate font-switzer text-xs text-black-primary dark:text-foreground">
                                    {key.split('/').pop()?.replace(/^\d+-/, '') || key}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </DashboardPanelSection>

            <DashboardPanelSection
                title="Data sync"
                description="Rebuild embeddings for Ask AI when you want deeper history search."
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-gray-secondary">
                        <div>
                            Last sync:{' '}
                            {agent.lastEmbeddingsSyncAt
                                ? formatDate(agent.lastEmbeddingsSyncAt)
                                : 'Never'}
                        </div>
                        {!hasUnsyncedConversations && (
                            <div>No new responses since last sync.</div>
                        )}
                    </div>
                    <Button
                        size="sm"
                        variant="secondary"
                        className="rounded-full px-3 text-[11px]"
                        disabled={!hasUnsyncedConversations || syncingEmbeddings}
                        onClick={handleSyncEmbeddings}
                    >
                        {syncingEmbeddings
                            ? 'Syncing...'
                            : hasUnsyncedConversations
                                ? 'Sync conversations'
                                : 'Up to date'}
                    </Button>
                </div>
            </DashboardPanelSection>

        </DashboardPanel>
    )

    return (
        <>
            <DashboardLayout sidebar={sidebar} rightPanel={rightPanel}>
                <AgentAskChat
                    agent={agent}
                    ownerId={ownerId}
                    ownerSessions={ownerSessions}
                />
            </DashboardLayout>
            <ConversationModal
                conversation={selectedConversation}
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
            />
        </>
    )
}
