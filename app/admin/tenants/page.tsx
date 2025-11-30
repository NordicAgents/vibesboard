'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { Button } from '@/components/ui/button'
import { DataTable, Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { CreateTenantDialog } from '@/components/tenants/create-tenant-dialog'
import { Database } from '@/lib/db_types'
import toast from 'react-hot-toast'

type Tenant = Database['public']['Tables']['tenants']['Row']

interface TenantWithStats extends Tenant {
    user_count?: number
    admin_email?: string
}

export default function TenantsPage() {
    const router = useRouter()
    const [tenants, setTenants] = React.useState<TenantWithStats[]>([])
    const [loading, setLoading] = React.useState(true)
    const [createDialogOpen, setCreateDialogOpen] = React.useState(false)

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

    const handleRowClick = (tenant: TenantWithStats) => {
        router.push(`/admin/tenants/${tenant.id}`)
    }

    const columns: Column<TenantWithStats>[] = [
        {
            key: 'name',
            label: 'Name',
            sortable: true,
            render: (tenant) => (
                <div className="flex flex-col gap-1">
                    <span className="font-medium">{tenant.name}</span>
                    <span className="text-xs text-muted-foreground">/{tenant.slug}</span>
                </div>
            ),
        },
        {
            key: 'status',
            label: 'Status',
            sortable: true,
            render: (tenant) => {
                const statusColors: Record<string, 'default' | 'secondary' | 'destructive'> = {
                    active: 'default',
                    trial: 'secondary',
                    suspended: 'destructive',
                }
                return (
                    <Badge variant={statusColors[tenant.status]} className="capitalize">
                        {tenant.status}
                    </Badge>
                )
            },
        },
        {
            key: 'admin_email',
            label: 'Admin',
            render: (tenant) => tenant.admin_email || 'N/A',
        },
        {
            key: 'user_count',
            label: 'Members',
            sortable: true,
            render: (tenant) => tenant.user_count || 0,
        },
        {
            key: 'created_at',
            label: 'Created',
            sortable: true,
            render: (tenant) => new Date(tenant.created_at).toLocaleDateString(),
        },
    ]

    return (
        <>
            <PageHeader
                title="Tenants"
                description="Manage all tenants in the system"
                actions={
                    <Button onClick={() => setCreateDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Tenant
                    </Button>
                }
            />

            <DataTable
                data={tenants}
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
                        action={{
                            label: 'Create Tenant',
                            onClick: () => setCreateDialogOpen(true),
                        }}
                    />
                }
            />

            <CreateTenantDialog
                open={createDialogOpen}
                onOpenChange={setCreateDialogOpen}
                onSuccess={fetchTenants}
            />
        </>
    )
}
