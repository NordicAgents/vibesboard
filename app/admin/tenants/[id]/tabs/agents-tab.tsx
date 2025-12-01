'use client'

import * as React from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Database } from '@/lib/db_types'
import { Bot, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

type VibeAgent = Database['public']['Tables']['vibe_agents']['Row']

interface TenantAgentsTabProps {
    tenantId: string
}

export function TenantAgentsTab({ tenantId }: TenantAgentsTabProps) {
    const [agents, setAgents] = React.useState<VibeAgent[]>([])
    const [loading, setLoading] = React.useState(true)

    React.useEffect(() => {
        const fetchAgents = async () => {
            try {
                setLoading(true)
                // Note: This requires updating the agents API to filter by tenant
                const response = await fetch(`/api/agents?tenant_id=${tenantId}`)

                if (!response.ok) {
                    throw new Error('Failed to fetch agents')
                }

                const data = await response.json()
                setAgents(data.agents || [])
            } catch (error) {
                console.error('Error fetching agents:', error)
                toast.error('Failed to load agents')
            } finally {
                setLoading(false)
            }
        }

        fetchAgents()
    }, [tenantId])

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Agents</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-32 animate-pulse rounded bg-muted" />
                        ))}
                    </div>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Agents</CardTitle>
                <CardDescription>
                    Agents created in this tenant workspace
                </CardDescription>
            </CardHeader>
            <CardContent>
                {agents.length === 0 ? (
                    <EmptyState
                        icon={Bot}
                        title="No agents created"
                        description="This tenant hasn't created any agents yet"
                    />
                ) : (
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                        {agents.map((agent) => (
                            <Link
                                key={agent.id}
                                href={`/agents/${agent.id}`}
                                className="group rounded-lg border p-4 transition-colors hover:bg-muted"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex items-center gap-2">
                                        <Bot className="h-5 w-5 text-muted-foreground" />
                                        <h4 className="font-medium">{agent.name || 'Unnamed Agent'}</h4>
                                    </div>
                                    <ExternalLink className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground">
                                    Created {new Date(agent.created_at).toLocaleDateString()}
                                </p>
                            </Link>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
