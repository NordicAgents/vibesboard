'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Bot, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
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

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function AgentsPage() {
  const router = useRouter()
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<Pagination | null>(null)

  useEffect(() => {
    fetchActiveTenant()
  }, [])

  useEffect(() => {
    if (tenantId) {
      fetchAgents(page)
    }
  }, [tenantId, page])

  const fetchActiveTenant = async () => {
    try {
      const response = await fetch('/api/user/active-tenant')
      if (response.ok) {
        const data = await response.json()
        setTenantId(data.tenant_id)
      } else {
        setTenantId(null)
        setIsLoading(false)
      }
    } catch (error) {
      console.error('Error fetching active tenant:', error)
      setIsLoading(false)
    }
  }

  const fetchAgents = async (currentPage: number) => {
    if (!tenantId) return

    try {
      setIsLoading(true)
      const limit = 9
      const response = await fetch(
        `/api/agents?tenant_id=${tenantId}&page=${currentPage}&limit=${limit}`
      )

      if (response.ok) {
        const data = await response.json()
        setAgents(data.agents || [])
        setPagination(data.pagination)
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

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && (!pagination || newPage <= pagination.totalPages)) {
      setPage(newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <div className="container py-8 space-y-8">
      <PageHeader
        title="vibesboard"
        description="Build Agents for Vibing with People"
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
            <div
              key={i}
              className="h-[200px] animate-pulse rounded-xl bg-muted"
            />
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
        <>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map(agent => (
              <Link key={agent.id} href={`/agents/${agent.id}?configure=true`}>
                <Card className="flex flex-col hover:bg-muted/50 transition-colors h-full">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <CardTitle className="line-clamp-1">
                        {agent.name}
                      </CardTitle>
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <CardDescription className="line-clamp-3">
                      {agent.instructions || 'No instructions provided'}
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination Controls */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center space-x-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <div className="text-sm font-medium">
                Page {page} of {pagination.totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page + 1)}
                disabled={page === pagination.totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
