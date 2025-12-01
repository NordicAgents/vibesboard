'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Bot, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface Agent {
    id: string
    name: string
    instructions: string
    agent_url: string
    created_at: string
    tenant_id: string | null
}

export default function AgentsPage() {
    const router = useRouter()
    const [agents, setAgents] = useState<Agent[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [tenantId, setTenantId] = useState<string | null>(null)

    useEffect(() => {
        fetchActiveTenant()
    }, [])

    useEffect(() => {
        if (tenantId) {
            fetchAgents()
        }
    }, [tenantId])

    const fetchActiveTenant = async () => {
        try {
            const response = await fetch('/api/user/active-tenant')
            if (response.ok) {
                const data = await response.json()
                setTenantId(data.tenant_id)
            } else {
                // Fallback or handle no tenant
                setTenantId(null)
                setIsLoading(false)
            }
        } catch (error) {
            console.error('Error fetching active tenant:', error)
            setIsLoading(false)
        }
    }

    const fetchAgents = async () => {
        if (!tenantId) return

        try {
            setIsLoading(true)
            const response = await fetch(`/api/agents?tenant_id=${tenantId}`)

            if (response.ok) {
                const data = await response.json()
                setAgents(data.agents || [])
            } else {
                toast.error('Failed to load agents')
            }
        } catch (error) {
            console.error('Error fetching agents:', error)
            toast.error('Failed to load agents')
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div className="container py-8 space-y-8">
            <PageHeader
                title="Agents"
                description="Manage your AI agents"
            >
                <Button asChild>
                    <Link href="/agents/new">
                        <Plus className="mr-2 h-4 w-4" />
                        Create Agent
                    </Link>
                </Button>
            </PageHeader>

            {isLoading ? (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {[...Array(3)].map((_, i) => (
                        <div key={i} className="h-[200px] animate-pulse rounded-xl bg-muted" />
                    ))}
                </div>
            ) : agents.length === 0 ? (
                <EmptyState
                    icon={Bot}
                    title="No agents yet"
                    description="Create your first AI agent to get started"
                    action={
                        <Button asChild>
                            <Link href="/agents/new">
                                <Plus className="mr-2 h-4 w-4" />
                                Create Agent
                            </Link>
                        </Button>
                    }
                />
            ) : (
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                    {agents.map((agent) => (
                        <Card key={agent.id} className="flex flex-col">
                            <CardHeader>
                                <div className="flex items-start justify-between">
                                    <CardTitle className="line-clamp-1">{agent.name}</CardTitle>
                                    <Bot className="h-5 w-5 text-muted-foreground" />
                                </div>
                                <CardDescription className="line-clamp-2">
                                    {agent.instructions || 'No instructions provided'}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-1">
                                <div className="text-xs text-muted-foreground">
                                    Created {new Date(agent.created_at).toLocaleDateString()}
                                </div>
                            </CardContent>
                            <CardFooter>
                                <Button variant="outline" className="w-full" asChild>
                                    <Link href={`/agents/${agent.id}`}>
                                        Manage Agent
                                    </Link>
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    )
}
