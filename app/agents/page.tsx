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
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6">
      <PageHeader
        title="vibesboard"
        description="Build Agents for Vibing with People"
        actions={
          <Button
            asChild
            className="border-0 bg-accent-orange text-white shadow-none hover:bg-[#C96747]"
          >
            <Link href="/agents/new">
              <Plus className="mr-2 size-4" />
              Create Agent
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="skeleton h-[180px] rounded-xl"
            />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="No agents yet"
          description="Create your first AI agent to get started"
          action={
            <Button
              asChild
              className="border-0 bg-accent-orange text-white shadow-none hover:bg-[#C96747]"
            >
              <Link href="/agents/new">
                <Plus className="mr-2 size-4" />
                Create Agent
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent, index) => (
              <Link
                key={agent.id}
                href={`/agents/${agent.id}?configure=true`}
                className={index < 5 ? `stagger- animate-fade-slide-in${index + 1}` : undefined}
              >
                <Card className="duration-[250ms] flex h-full flex-col rounded-xl border border-[#E2DDD4] bg-[#FDFAF5] shadow-soft transition-all hover:-translate-y-0.5 hover:shadow-md">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="line-clamp-1 font-serif text-base font-normal text-[#1A1915]">
                        {agent.name}
                      </CardTitle>
                      <Bot className="size-5 shrink-0 text-accent-orange" />
                    </div>
                    <CardDescription className="line-clamp-2 text-sm text-[#6B6560]">
                      {agent.instructions || 'No instructions provided'}
                    </CardDescription>
                    {agent.created_at && (
                      <p className="mt-auto pt-2 text-xs text-[#9D9790]">
                        {new Date(agent.created_at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })}
                      </p>
                    )}
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>

          {/* Pagination Controls */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page - 1)}
                disabled={page === 1}
                className="border-[#E2DDD4] text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] disabled:opacity-40"
              >
                <ChevronLeft className="size-4" />
                Previous
              </Button>
              <div className="px-2 text-sm text-[#6B6560]">
                Page {page} of {pagination.totalPages}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handlePageChange(page + 1)}
                disabled={page === pagination.totalPages}
                className="border-[#E2DDD4] text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] disabled:opacity-40"
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
