'use client'

import { useState, useEffect } from 'react'
import { Plus, MoreHorizontal, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { Badge } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { CreateFeatureFlagDialog } from '@/components/tenants/create-feature-flag-dialog'
import toast from 'react-hot-toast'

interface FeatureFlag {
    id: string
    name: string
    description: string | null
    default_value: boolean
    created_at: string
    updated_at: string
}

export default function FeatureFlagsPage() {
    const [flags, setFlags] = useState<FeatureFlag[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [searchQuery, setSearchQuery] = useState('')
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)

    useEffect(() => {
        fetchFlags()
    }, [])

    const fetchFlags = async () => {
        try {
            setIsLoading(true)
            const response = await fetch('/api/admin/feature-flags')
            if (response.ok) {
                const data = await response.json()
                setFlags(data.flags || [])
            } else {
                toast.error('Failed to load feature flags')
            }
        } catch (error) {
            console.error('Error fetching flags:', error)
            toast.error('Failed to load feature flags')
        } finally {
            setIsLoading(false)
        }
    }

    const handleArchive = async (flagId: string) => {
        if (!confirm('Are you sure you want to archive this feature flag?')) {
            return
        }

        try {
            const response = await fetch(`/api/admin/feature-flags/${flagId}`, {
                method: 'DELETE'
            })

            if (response.ok) {
                toast.success('Feature flag archived')
                fetchFlags()
            } else {
                toast.error('Failed to archive feature flag')
            }
        } catch (error) {
            console.error('Error archiving flag:', error)
            toast.error('Failed to archive feature flag')
        }
    }

    const handleCreateSuccess = () => {
        setIsCreateDialogOpen(false)
        fetchFlags()
    }

    const filteredFlags = flags.filter(flag =>
        flag.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        flag.description?.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="space-y-6">
            <PageHeader
                title="Feature Flags"
                description="Manage feature flags that can be toggled per tenant"
            >
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Feature Flag
                </Button>
            </PageHeader>

            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        placeholder="Search feature flags..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-9"
                    />
                </div>
            </div>

            {isLoading ? (
                <div className="space-y-3">
                    {[...Array(5)].map((_, i) => (
                        <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
                    ))}
                </div>
            ) : filteredFlags.length === 0 ? (
                <EmptyState
                    icon={Plus}
                    title={searchQuery ? 'No flags found' : 'No feature flags yet'}
                    description={
                        searchQuery
                            ? 'Try adjusting your search query'
                            : 'Create your first feature flag to enable tenant-specific features'
                    }
                    action={
                        !searchQuery ? (
                            <Button onClick={() => setIsCreateDialogOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" />
                                Create Feature Flag
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="rounded-lg border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Default Value</TableHead>
                                <TableHead className="w-[100px]">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredFlags.map((flag) => (
                                <TableRow key={flag.id}>
                                    <TableCell className="font-mono text-sm font-semibold">
                                        {flag.name}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {flag.description || '—'}
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={flag.default_value ? 'default' : 'secondary'}>
                                            {flag.default_value ? 'Enabled' : 'Disabled'}
                                        </Badge>
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
                                                    onClick={() => handleArchive(flag.id)}
                                                    className="text-destructive"
                                                >
                                                    Archive
                                                </DropdownMenuItem>
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}

            <CreateFeatureFlagDialog
                open={isCreateDialogOpen}
                onOpenChange={setIsCreateDialogOpen}
                onSuccess={handleCreateSuccess}
            />
        </div>
    )
}
