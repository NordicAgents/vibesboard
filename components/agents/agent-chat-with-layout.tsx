'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { type VibeAgent, type VibeAgentConversation } from '@/lib/types'
import { DashboardLayout } from '@/components/layouts/dashboard-layout'
import { DashboardSidebar, DashboardSidebarSection, DashboardSidebarItem } from '@/components/layouts/dashboard-sidebar'
import { DashboardPanel, DashboardPanelSection } from '@/components/layouts/dashboard-panel'
import { AgentAskChat } from '@/components/agents/agent-ask-chat'
import { Badge } from '@/components/ui/badge'
import { IconFile } from '@/components/ui/icons'

interface AgentChatWithLayoutProps {
    agent: VibeAgent
    ownerId: string
    ownerSessions: VibeAgentConversation[]
}

export function AgentChatWithLayout({
    agent,
    ownerId,
    ownerSessions
}: AgentChatWithLayoutProps) {
    const router = useRouter()
    const [activeSessionId, setActiveSessionId] = React.useState<string | null>(
        ownerSessions[0]?.id ?? null
    )

    const handleSelectSession = (sessionId: string | null) => {
        setActiveSessionId(sessionId)
        if (sessionId) {
            router.push(`/agents/${agent.id}?session=${sessionId}`)
        }
    }

    const handleNewChat = () => {
        setActiveSessionId(null)
        router.push(`/agents/${agent.id}`)
    }

    const sidebar = (
        <DashboardSidebar>
            {/* Agent Info */}
            <div className="mb-4 rounded-2xl border border-black-10 bg-beige-bg/30 p-4 dark:bg-background/30 dark:border-border">
                <h3 className="font-switzer text-lg font-bold text-black-primary dark:text-foreground">
                    {agent.name}
                </h3>
                <p className="mt-1 font-switzer text-xs text-gray-secondary">
                    Chat with your agent
                </p>
            </div>

            {/* Conversations */}
            <DashboardSidebarSection title="Conversations">
                <DashboardSidebarItem
                    active={activeSessionId === null}
                    onClick={handleNewChat}
                >
                    <div className="flex items-center justify-between">
                        <span>New conversation</span>
                        <span className="text-xs">+</span>
                    </div>
                </DashboardSidebarItem>

                {ownerSessions.slice(0, 10).map((session) => (
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
    )

    const rightPanel = (
        <DashboardPanel title="Agent Details">
            {/* Tools Section */}
            <DashboardPanelSection
                title="Tools"
                description={agent.tools.length > 0 ? `${agent.tools.length} enabled` : 'None enabled'}
            >
                {agent.tools.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {agent.tools.map((tool) => (
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

            {/* Instructions Preview */}
            <DashboardPanelSection title="Instructions">
                <div className="rounded-2xl bg-beige-bg/30 p-3 dark:bg-background/30">
                    <p className="line-clamp-4 font-switzer text-xs text-black-primary dark:text-foreground">
                        {agent.instructions}
                    </p>
                </div>
            </DashboardPanelSection>
        </DashboardPanel>
    )

    return (
        <DashboardLayout sidebar={sidebar} rightPanel={rightPanel}>
            <AgentAskChat
                agent={agent}
                ownerId={ownerId}
                ownerSessions={ownerSessions}
            />
        </DashboardLayout>
    )
}
