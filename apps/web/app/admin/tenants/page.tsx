'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus, User, Building2, Trash2, Loader2 } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { DataTable, Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { CreateTenantDialog } from '@/components/tenants'
import { UsageProgress } from '@/components/usage-progress'
import type { TenantDocument, TenantSubscription } from '@vibesboard/contracts'
import type { PlanId } from '@vibesboard/policy/plans'
import toast from 'react-hot-toast'

interface TenantWithStats extends TenantDocument {
  userCount?: number
  user_count?: number
  adminEmail?: string
  creator_email?: string | null
  creator_name?: string | null
}

export default function TenantsPage() {
  const router = useRouter()
  const [tenants, setTenants] = React.useState<TenantWithStats[]>([])
  const [loading, setLoading] = React.useState(true)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)

  // Filter state
  const [typeFilter, setTypeFilter] = React.useState<
    'all' | 'organization' | 'personal'
  >('all')

  // Delete state
  const [deleteTarget, setDeleteTarget] =
    React.useState<TenantWithStats | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = React.useState('')
  const [isDeleting, setIsDeleting] = React.useState(false)

  const fetchTenants = React.useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/admin/tenants')

      if (!response.ok) {
        throw new Error('Failed to fetch tenants')
      }

      const data = await response.json()
      setTenants(data.tenants || [])
    } catch (error) {
      console.error('Error fetching tenants:', error)
      toast.error('Failed to load tenants')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchTenants()
  }, [fetchTenants])

  const filteredTenants = React.useMemo(() => {
    if (typeFilter === 'all') return tenants
    if (typeFilter === 'personal') return tenants.filter(t => t.isPersonal)
    return tenants.filter(t => !t.isPersonal)
  }, [tenants, typeFilter])

  const personalCount = React.useMemo(
    () => tenants.filter(t => t.isPersonal).length,
    [tenants]
  )
  const orgCount = React.useMemo(
    () => tenants.filter(t => !t.isPersonal).length,
    [tenants]
  )

  const handleRowClick = (tenant: TenantWithStats) => {
    router.push(`/admin/tenants/${tenant.id}`)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/admin/tenants/${deleteTarget.id}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        toast.success(
          `Tenant "${deleteTarget.name}" and all its data have been deleted`
        )
        setDeleteTarget(null)
        setDeleteConfirmText('')
        fetchTenants()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to delete tenant')
      }
    } catch (error) {
      console.error('Error deleting tenant:', error)
      toast.error('Failed to delete tenant')
    } finally {
      setIsDeleting(false)
    }
  }

  const columns: Column<TenantWithStats>[] = [
    {
      key: 'name',
      label: 'Name',
      sortable: true,
      render: tenant => {
        const displayName = tenant.isPersonal
          ? tenant.creator_name || tenant.creator_email || tenant.name
          : tenant.name
        const subtitle = tenant.isPersonal
          ? tenant.creator_email || `/${tenant.slug}`
          : tenant.creator_email || `/${tenant.slug}`
        return (
          <div className="flex items-center gap-2.5">
            <div
              className={`flex size-7 shrink-0 items-center justify-center rounded-md ${tenant.isPersonal ? 'bg-[#e8e6ed] dark:bg-[#3a3448]' : 'bg-[#e6ede6] dark:bg-[#344348]'}`}
            >
              {tenant.isPersonal ? (
                <User className="size-3.5 text-[#6f7f80]" />
              ) : (
                <Building2 className="size-3.5 text-accent-orange" />
              )}
            </div>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="font-medium">{displayName}</span>
                {tenant.isPersonal && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0"
                  >
                    Personal
                  </Badge>
                )}
              </div>
              {subtitle && subtitle !== displayName && (
                <span className="text-xs text-muted-foreground">
                  {subtitle}
                </span>
              )}
            </div>
          </div>
        )
      }
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: tenant => {
        const statusColors: Record<
          string,
          'default' | 'secondary' | 'destructive'
        > = {
          active: 'default',
          trial: 'secondary',
          suspended: 'destructive'
        }
        return (
          <Badge variant={statusColors[tenant.status]} className="capitalize">
            {tenant.status}
          </Badge>
        )
      }
    },
    {
      key: 'adminEmail',
      label: 'Owner',
      render: tenant => {
        const email = tenant.creator_email
        const name = tenant.creator_name
        if (!email && !name) {
          return (
            <span
              className="font-mono text-xs text-muted-foreground"
              title="User ID (no profile found)"
            >
              {tenant.createdBy
                ? `uid:${tenant.createdBy.slice(0, 12)}…`
                : 'Unknown'}
            </span>
          )
        }
        return (
          <div className="flex flex-col">
            {name && <span className="text-sm">{name}</span>}
            {email && (
              <span
                className={name ? 'text-xs text-muted-foreground' : 'text-sm'}
              >
                {email}
              </span>
            )}
          </div>
        )
      }
    },
    {
      key: 'userCount',
      label: 'Members',
      sortable: true,
      render: tenant => tenant.user_count ?? tenant.userCount ?? 0
    },
    {
      key: 'plan',
      label: 'Plan',
      render: tenant => {
        const planId = tenant.subscription?.planId as PlanId | undefined
        if (!planId)
          return <span className="text-xs text-muted-foreground">—</span>
        const planColors: Record<string, 'default' | 'secondary'> = {
          free: 'secondary',
          pro: 'default',
          team: 'default',
          enterprise: 'default'
        }
        return (
          <Badge
            variant={planColors[planId] ?? 'secondary'}
            className="capitalize"
          >
            {planId}
          </Badge>
        )
      }
    },
    {
      key: 'usage',
      label: 'Usage',
      render: tenant => {
        const sub = tenant.subscription as TenantSubscription | undefined
        if (!sub)
          return <span className="text-xs text-muted-foreground">—</span>
        return (
          <UsageProgress
            used={sub.messageCount ?? 0}
            limit={sub.messageLimit ?? 0}
            planId={sub.planId}
            compact
          />
        )
      }
    },
    {
      key: 'createdAt',
      label: 'Created',
      sortable: true,
      render: tenant => new Date(tenant.createdAt).toLocaleDateString()
    },
    {
      key: 'id',
      label: '',
      render: tenant => (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-destructive"
          onClick={e => {
            e.stopPropagation()
            setDeleteTarget(tenant)
            setDeleteConfirmText('')
          }}
          title="Delete tenant"
        >
          <Trash2 className="size-4" />
        </Button>
      )
    }
  ]

  const deleteConfirmSlug = deleteTarget?.slug || ''
  const canConfirmDelete = deleteConfirmText === deleteConfirmSlug

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Manage all tenants in the system"
        actions={
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 size-4" />
            Create Tenant
          </Button>
        }
      />

      {!loading && tenants.length > 0 && (
        <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-1 w-fit">
          {[
            { value: 'all' as const, label: 'All', count: tenants.length },
            {
              value: 'organization' as const,
              label: 'Organization',
              count: orgCount
            },
            {
              value: 'personal' as const,
              label: 'Personal',
              count: personalCount
            }
          ].map(option => (
            <button
              key={option.value}
              onClick={() => setTypeFilter(option.value)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
                typeFilter === option.value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {option.value === 'organization' && (
                <Building2 className="size-3.5" />
              )}
              {option.value === 'personal' && <User className="size-3.5" />}
              {option.label}
              <span
                className={`text-xs ${
                  typeFilter === option.value
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/60'
                }`}
              >
                {option.count}
              </span>
            </button>
          ))}
        </div>
      )}

      <DataTable
        data={filteredTenants}
        columns={columns}
        searchable
        searchPlaceholder="Search by name or slug..."
        searchKeys={['name', 'slug']}
        pagination
        pageSize={10}
        loading={loading}
        onRowClick={handleRowClick}
        emptyState={
          <EmptyState
            icon={Plus}
            title="No tenants yet"
            description="Get started by creating your first tenant"
            action={
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 size-4" />
                Create Tenant
              </Button>
            }
          />
        }
      />

      <CreateTenantDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={fetchTenants}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={open => {
          if (!open) {
            setDeleteTarget(null)
            setDeleteConfirmText('')
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">
              Delete Tenant
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deleteTarget?.name}</strong>{' '}
              and all associated data including agents, conversations, files,
              members, and invitations. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {deleteTarget && (
            <div className="space-y-4 py-2">
              {deleteTarget.creator_email && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm">
                  <span className="text-muted-foreground">Owner: </span>
                  <span className="font-medium">
                    {deleteTarget.creator_name &&
                      `${deleteTarget.creator_name} — `}
                    {deleteTarget.creator_email}
                  </span>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="confirm-slug">
                  Type{' '}
                  <span className="font-mono font-bold text-destructive">
                    {deleteConfirmSlug}
                  </span>{' '}
                  to confirm
                </Label>
                <Input
                  id="confirm-slug"
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder={deleteConfirmSlug}
                  autoFocus
                  disabled={isDeleting}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDeleteTarget(null)
                setDeleteConfirmText('')
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!canConfirmDelete || isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 size-4" />
                  Delete Permanently
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
