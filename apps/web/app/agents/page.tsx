'use client'

import { useCallback, useEffect, useState } from 'react'
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
import { SkeletonCard } from '@/components/ui/skeleton'
import { toastWithRetry } from '@/lib/toast-helpers'
import toast from 'react-hot-toast'
import Link from 'next/link'

// Mirrors the projection in app/api/agents/route.ts, which is camelCase. These
// three were declared snake_case, so `agent.createdAt` was always undefined
// and the "created" line never rendered on any card.
interface Agent {
  id: string
  name: string
  instructions: string
  agentUrl: string
  createdAt: string
  tenantId: string | null
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

    const handleTenantChanged = (e: Event) => {
      const tenantId = (e as CustomEvent).detail?.tenantId
      if (tenantId) {
        setTenantId(tenantId)
        setPage(1)
      } else {
        fetchActiveTenant()
      }
    }
    window.addEventListener('tenantChanged', handleTenantChanged)
    return () =>
      window.removeEventListener('tenantChanged', handleTenantChanged)
  }, [])

  // Declared as a *named* function expression so the retry handlers below can
  // call `load` recursively without listing `fetchAgents` as a dependency of
  // its own useCallback.
  const fetchAgents = useCallback(
    async function load(currentPage: number) {
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
          toastWithRetry('Could not load agents', () => load(currentPage))
        }
      } catch (error) {
        console.error('Error fetching agents:', error)
        toastWithRetry('Could not load agents. Check your connection.', () =>
          load(currentPage)
        )
      } finally {
        setIsLoading(false)
      }
    },
    [tenantId]
  )

  useEffect(() => {
    if (tenantId) {
      fetchAgents(page)
    }
  }, [tenantId, page, fetchAgents])

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

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && (!pagination || newPage <= pagination.totalPages)) {
      setPage(newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:space-y-8 sm:px-6 sm:py-8">
        <PageHeader
          title="vibesboard"
          description="Build Agents for Vibing with People"
          actions={
            <Button asChild className="border-0 shadow-none">
              <Link href="/agents/create-chat">
                <Plus className="mr-2 size-4" />
                Create Agent
              </Link>
            </Button>
          }
        />

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents yet"
            description="Create your first AI agent to get started"
            action={
              <Button asChild className="border-0 shadow-none">
                <Link href="/agents/create-chat">
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
                  href={`/agents/${agent.id}?tab=configure`}
                  className={
                    index < 5
                      ? `stagger- animate-fade-slide-in${index + 1}`
                      : undefined
                  }
                >
                  <Card className="duration-&lsqb;250ms&rsqb; flex h-full flex-col rounded-xl transition-all hover:-translate-y-0.5 hover:shadow-md">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="line-clamp-1 font-sans text-base font-normal text-[#222f30] dark:text-[#f5f8f7]">
                          {agent.name}
                        </CardTitle>
                        <Bot className="size-5 shrink-0 text-accent-orange" />
                      </div>
                      <CardDescription className="line-clamp-2 text-sm text-[#445e5f] dark:text-[#c9cbbe]">
                        {agent.instructions || 'No instructions provided'}
                      </CardDescription>
                      {agent.createdAt && (
                        <p className="mt-auto pt-2 text-xs text-[#6f7f80] dark:text-[#7e8e8f]">
                          {new Date(agent.createdAt).toLocaleDateString(
                            'en-US',
                            {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            }
                          )}
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
                  className="border-[#e4e3e3] text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] disabled:opacity-40 dark:border-[#344348] dark:text-[#c9cbbe] dark:hover:bg-[#253435] dark:hover:text-[#f5f8f7]"
                >
                  <ChevronLeft className="size-4" />
                  Previous
                </Button>
                <div className="px-2 text-sm text-[#445e5f] dark:text-[#c9cbbe]">
                  Page {page} of {pagination.totalPages}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page === pagination.totalPages}
                  className="border-[#e4e3e3] text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] disabled:opacity-40 dark:border-[#344348] dark:text-[#c9cbbe] dark:hover:bg-[#253435] dark:hover:text-[#f5f8f7]"
                >
                  Next
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
