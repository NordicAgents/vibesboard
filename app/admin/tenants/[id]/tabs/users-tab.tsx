'use client'

import * as React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DataTable, Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { RoleBadge } from '@/components/tenants'
import type { TenantMemberDocument } from '@/lib/firestore-types'
import { UserPlus, MoreHorizontal, Loader2, Copy } from 'lucide-react'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import toast from 'react-hot-toast'

interface TenantUserWithEmail extends TenantMemberDocument {
    email?: string
}

interface TenantUsersTabProps {
    tenantId: string
    tenantName: string
}

export function TenantUsersTab({ tenantId, tenantName }: TenantUsersTabProps) {
    const [users, setUsers] = React.useState<TenantUserWithEmail[]>([])
    const [loading, setLoading] = React.useState(true)
    const [inviteOpen, setInviteOpen] = React.useState(false)
    const [inviteEmail, setInviteEmail] = React.useState('')
    const [inviteRole, setInviteRole] = React.useState<'TENANT_ADMIN' | 'MEMBER'>('MEMBER')
    const [inviteUrl, setInviteUrl] = React.useState<string | null>(null)
    const [isInviting, setIsInviting] = React.useState(false)

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

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!inviteEmail) {
            toast.error('Email is required')
            return
        }

        try {
            setIsInviting(true)
            setInviteUrl(null)

            const response = await fetch(`/api/tenants/${tenantId}/invitations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: inviteEmail,
                    role: inviteRole
                }),
            })

            const data = await response.json().catch(() => ({}))

            if (!response.ok) {
                throw new Error(data.error || 'Failed to send invitation')
            }

            setInviteUrl(data.inviteUrl || null)
            toast.success('Invitation sent successfully')
        } catch (error) {
            console.error('Error sending invitation:', error)
            toast.error(error instanceof Error ? error.message : 'Failed to send invitation')
        } finally {
            setIsInviting(false)
        }
    }

    const handleCopyInviteUrl = async () => {
        if (!inviteUrl) return
        try {
            await navigator.clipboard.writeText(inviteUrl)
            toast.success('Invite link copied')
        } catch {
            toast.error('Failed to copy invite link')
        }
    }

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
            render: (user) => user.email || user.userId,
        },
        {
            key: 'role',
            label: 'Role',
            sortable: true,
            render: (user) => <RoleBadge role={user.role} />,
        },
        {
            key: 'createdAt',
            label: 'Joined',
            sortable: true,
            render: (user) => new Date(user.createdAt).toLocaleDateString(),
        },
        {
            key: 'actions',
            label: '',
            render: (user) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                            <MoreHorizontal className="size-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onClick={() =>
                                handleChangeRole(
                                    user.userId,
                                    user.role === 'TENANT_ADMIN' ? 'MEMBER' : 'TENANT_ADMIN'
                                )
                            }
                        >
                            Change to {user.role === 'TENANT_ADMIN' ? 'Member' : 'Admin'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleRemoveUser(user.userId)}
                        >
                            Remove User
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
    ]

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Team Members</CardTitle>
                            <CardDescription>
                                Manage users who have access to {tenantName}
                            </CardDescription>
                        </div>
                        <Button size="sm" onClick={() => setInviteOpen(true)}>
                            <UserPlus className="mr-2 size-4" />
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

            <Dialog
                open={inviteOpen}
                onOpenChange={(open) => {
                    if (!open && !isInviting) {
                        setInviteEmail('')
                        setInviteRole('MEMBER')
                        setInviteUrl(null)
                    }
                    setInviteOpen(open)
                }}
            >
                <DialogContent>
                    <form onSubmit={handleInvite}>
                        <DialogHeader>
                            <DialogTitle>Invite User</DialogTitle>
                            <DialogDescription>
                                Send an invitation to join {tenantName}.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="invite-email">Email</Label>
                                <Input
                                    id="invite-email"
                                    type="email"
                                    placeholder="user@example.com"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    disabled={isInviting}
                                    autoFocus
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="invite-role">Role</Label>
                                <Select
                                    value={inviteRole}
                                    onValueChange={(value: 'TENANT_ADMIN' | 'MEMBER') => setInviteRole(value)}
                                >
                                    <SelectTrigger id="invite-role" disabled={isInviting}>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="MEMBER">Member</SelectItem>
                                        <SelectItem value="TENANT_ADMIN">Tenant Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {inviteUrl && (
                                <div className="space-y-2">
                                    <Label htmlFor="invite-link">Invite Link</Label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            id="invite-link"
                                            value={inviteUrl}
                                            readOnly
                                            className="font-mono text-xs"
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleCopyInviteUrl}
                                        >
                                            <Copy className="size-4" />
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        Use this link if email delivery is delayed.
                                    </p>
                                </div>
                            )}
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setInviteOpen(false)}
                                disabled={isInviting}
                            >
                                Close
                            </Button>
                            <Button type="submit" disabled={isInviting}>
                                {isInviting ? (
                                    <>
                                        <Loader2 className="mr-2 size-4 animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    'Send Invite'
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
