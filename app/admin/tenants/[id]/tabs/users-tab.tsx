'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable, Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { RoleBadge } from '@/components/tenants'
import { Database } from '@/lib/db_types'
import { UserPlus, MoreHorizontal } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import toast from 'react-hot-toast'

type TenantUser = Database['public']['Tables']['tenant_users']['Row']

interface TenantUserWithEmail extends TenantUser {
    email?: string
}

interface TenantUsersTabProps {
    tenantId: string
    tenantName: string
}

export function TenantUsersTab({ tenantId, tenantName }: TenantUsersTabProps) {
    const [users, setUsers] = React.useState<TenantUserWithEmail[]>([])
    const [loading, setLoading] = React.useState(true)

    const fetchUsers = React.useCallback(async () => {
        try {
            setLoading(true)
            const response = await fetch(`/api/tenants/${tenantId}/users`)

            if (!response.ok) {
                throw new Error('Failed to fetch users')
            }

            const data = await response.json()
            setUsers(data.users || [])
        } catch (error) {
            console.error('Error fetching users:', error)
            toast.error('Failed to load team members')
        } finally {
            setLoading(false)
        }
    }, [tenantId])

    React.useEffect(() => {
        fetchUsers()
    }, [fetchUsers])

    const handleChangeRole = async (userId: string, newRole: string) => {
        try {
            const response = await fetch(`/api/tenants/${tenantId}/users/${userId}/role`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole }),
            })

            if (!response.ok) {
                throw new Error('Failed to update role')
            }

            toast.success('Role updated successfully')
            fetchUsers()
        } catch (error) {
            console.error('Error updating role:', error)
            toast.error('Failed to update role')
        }
    }

    const handleRemoveUser = async (userId: string) => {
        if (!confirm('Are you sure you want to remove this user from the tenant?')) {
            return
        }

        try {
            const response = await fetch(`/api/tenants/${tenantId}/users/${userId}/role`, {
                method: 'DELETE',
            })

            if (!response.ok) {
                throw new Error('Failed to remove user')
            }

            toast.success('User removed successfully')
            fetchUsers()
        } catch (error) {
            console.error('Error removing user:', error)
            toast.error('Failed to remove user')
        }
    }

    const columns: Column<TenantUserWithEmail>[] = [
        {
            key: 'email',
            label: 'Email',
            sortable: true,
            render: (user) => user.email || user.user_id,
        },
        {
            key: 'role',
            label: 'Role',
            sortable: true,
            render: (user) => <RoleBadge role={user.role} />,
        },
        {
            key: 'created_at',
            label: 'Joined',
            sortable: true,
            render: (user) => new Date(user.created_at).toLocaleDateString(),
        },
        {
            key: 'actions',
            label: '',
            render: (user) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onClick={() =>
                                handleChangeRole(
                                    user.user_id,
                                    user.role === 'TENANT_ADMIN' ? 'MEMBER' : 'TENANT_ADMIN'
                                )
                            }
                        >
                            Change to {user.role === 'TENANT_ADMIN' ? 'Member' : 'Admin'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleRemoveUser(user.user_id)}
                        >
                            Remove User
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
    ]

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Team Members</CardTitle>
                        <CardDescription>
                            Manage users who have access to {tenantName}
                        </CardDescription>
                    </div>
                    <Button size="sm">
                        <UserPlus className="mr-2 h-4 w-4" />
                        Invite User
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <DataTable
                    data={users}
                    columns={columns}
                    loading={loading}
                    pagination
                    pageSize={10}
                    emptyState={
                        <EmptyState
                            icon={UserPlus}
                            title="No team members"
                            description="This tenant has no users yet"
                        />
                    }
                />
            </CardContent>
        </Card>
    )
}
