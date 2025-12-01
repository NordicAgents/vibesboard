'use client'

import { useState, useEffect } from 'react'
import { Plus, MoreHorizontal, Mail, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table'
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleBadge } from '@/components/tenants/role-badge'
import { EmptyState } from '@/components/ui/empty-state'
import { type Role } from '@/lib/permissions'
import toast from 'react-hot-toast'

interface TenantMember {
    user_id: string
    email: string
    role: Role
    joined_at: string
}

interface PendingInvitation {
    id: string
    email: string
    role: Role
    created_at: string
    expires_at: string
}

export default function TeamManagementPage() {
    const [tenantId, setTenantId] = useState<string | null>(null)
    const [members, setMembers] = useState<TenantMember[]>([])
    const [invitations, setInvitations] = useState<PendingInvitation[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false)

    // Invite form state
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteRole, setInviteRole] = useState<'TENANT_ADMIN' | 'MEMBER'>('MEMBER')
    const [isInviting, setIsInviting] = useState(false)

    useEffect(() => {
        fetchActiveTenant()
    }, [])

    useEffect(() => {
        if (tenantId) {
            fetchMembers()
            fetchInvitations()
        }
    }, [tenantId])

    const fetchActiveTenant = async () => {
        try {
            const response = await fetch('/api/user/active-tenant')
            if (response.ok) {
                const data = await response.json()
                setTenantId(data.tenant_id)
            }
        } catch (error) {
            console.error('Error fetching active tenant:', error)
            toast.error('Failed to load tenant')
        }
    }

    const fetchMembers = async () => {
        if (!tenantId) return

        try {
            setIsLoading(true)
            const response = await fetch(`/api/tenants/${tenantId}/users`)
            if (response.ok) {
                const data = await response.json()
                setMembers(data.users || [])
            }
        } catch (error) {
            console.error('Error fetching members:', error)
            toast.error('Failed to load team members')
        } finally {
            setIsLoading(false)
        }
    }

    const fetchInvitations = async () => {
        if (!tenantId) return

        try {
            const response = await fetch(`/api/tenants/${tenantId}/invitations`)
            if (response.ok) {
                const data = await response.json()
                setInvitations(data.invitations || [])
            }
        } catch (error) {
            console.error('Error fetching invitations:', error)
        }
    }

    const handleInvite = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!tenantId || !inviteEmail) return

        setIsInviting(true)
        try {
            const response = await fetch(`/api/tenants/${tenantId}/invitations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: inviteEmail,
                    role: inviteRole
                })
            })

            const data = await response.json()

            if (response.ok) {
                toast.success('Invitation sent successfully')
                setIsInviteDialogOpen(false)
                setInviteEmail('')
                setInviteRole('MEMBER')
                fetchInvitations()
            } else {
                toast.error(data.error || 'Failed to send invitation')
            }
        } catch (error) {
            console.error('Error sending invitation:', error)
            toast.error('Failed to send invitation')
        } finally {
            setIsInviting(false)
        }
    }

    const handleChangeRole = async (userId: string, newRole: string) => {
        if (!tenantId) return

        try {
            const response = await fetch(`/api/tenants/${tenantId}/users/${userId}/role`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ role: newRole })
            })

            if (response.ok) {
                toast.success('Role updated successfully')
                fetchMembers()
            } else {
                const data = await response.json()
                toast.error(data.error || 'Failed to update role')
            }
        } catch (error) {
            console.error('Error updating role:', error)
            toast.error('Failed to update role')
        }
    }

    const handleRemoveMember = async (userId: string, email: string) => {
        if (!tenantId) return

        if (!confirm(`Are you sure you want to remove ${email} from this tenant?`)) {
            return
        }

        try {
            const response = await fetch(`/api/tenants/${tenantId}/users/${userId}/role`, {
                method: 'DELETE'
            })

            if (response.ok) {
                toast.success('Member removed successfully')
                fetchMembers()
            } else {
                const data = await response.json()
                toast.error(data.error || 'Failed to remove member')
            }
        } catch (error) {
            console.error('Error removing member:', error)
            toast.error('Failed to remove member')
        }
    }

    const handleCancelInvitation = async (invitationId: string) => {
        if (!confirm('Are you sure you want to cancel this invitation?')) {
            return
        }

        try {
            const response = await fetch(`/api/invitations/${invitationId}`, {
                method: 'DELETE'
            })

            if (response.ok) {
                toast.success('Invitation cancelled')
                fetchInvitations()
            } else {
                toast.error('Failed to cancel invitation')
            }
        } catch (error) {
            console.error('Error cancelling invitation:', error)
            toast.error('Failed to cancel invitation')
        }
    }

    return (
        <div className="space-y-6">
            <PageHeader
                title="Team Management"
                description="Manage your team members and invitations"
            >
                <Button onClick={() => setIsInviteDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Invite Member
                </Button>
            </PageHeader>

            {/* Team Members */}
            <Card>
                <CardHeader>
                    <CardTitle>Team Members</CardTitle>
                    <CardDescription>
                        Active members of your tenant
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : members.length === 0 ? (
                        <EmptyState
                            icon={Mail}
                            title="No team members"
                            description="Invite team members to collaborate"
                        />
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Joined</TableHead>
                                    <TableHead className="w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {members.map((member) => (
                                    <TableRow key={member.user_id}>
                                        <TableCell>{member.email}</TableCell>
                                        <TableCell>
                                            <RoleBadge role={member.role} />
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {new Date(member.joined_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="icon">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        onClick={() => handleChangeRole(
                                                            member.user_id,
                                                            member.role === 'TENANT_ADMIN' ? 'MEMBER' : 'TENANT_ADMIN'
                                                        )}
                                                    >
                                                        Make {member.role === 'TENANT_ADMIN' ? 'Member' : 'Admin'}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => handleRemoveMember(member.user_id, member.email)}
                                                        className="text-destructive"
                                                    >
                                                        Remove
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Pending Invitations */}
            {invitations.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Pending Invitations</CardTitle>
                        <CardDescription>
                            Invitations waiting to be accepted
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Email</TableHead>
                                    <TableHead>Role</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead className="w-[100px]">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {invitations.map((invitation) => (
                                    <TableRow key={invitation.id}>
                                        <TableCell>{invitation.email}</TableCell>
                                        <TableCell>
                                            <RoleBadge role={invitation.role} />
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {new Date(invitation.expires_at).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleCancelInvitation(invitation.id)}
                                            >
                                                Cancel
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Invite Dialog */}
            <Dialog open={isInviteDialogOpen} onOpenChange={setIsInviteDialogOpen}>
                <DialogContent>
                    <form onSubmit={handleInvite}>
                        <DialogHeader>
                            <DialogTitle>Invite Team Member</DialogTitle>
                            <DialogDescription>
                                Send an invitation to join your tenant
                            </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="colleague@example.com"
                                    value={inviteEmail}
                                    onChange={(e) => setInviteEmail(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="role">Role</Label>
                                <Select
                                    value={inviteRole}
                                    onValueChange={(value: 'TENANT_ADMIN' | 'MEMBER') => setInviteRole(value)}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="MEMBER">Member</SelectItem>
                                        <SelectItem value="TENANT_ADMIN">Tenant Admin</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <DialogFooter>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setIsInviteDialogOpen(false)}
                                disabled={isInviting}
                            >
                                Cancel
                            </Button>
                            <Button type="submit" disabled={isInviting}>
                                {isInviting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Sending...
                                    </>
                                ) : (
                                    'Send Invitation'
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
