'use client'

import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { TenantDocument } from '@/lib/firestore-types'

interface TenantCardProps {
    tenant: TenantDocument
    userCount?: number
    showActions?: boolean
    onEdit?: () => void
    onDelete?: () => void
}

export function TenantCard({
    tenant,
    userCount = 0,
    showActions = false,
    onEdit,
    onDelete
}: TenantCardProps) {
    const statusColors: Record<string, string> = {
        active: 'bg-green-500',
        trial: 'bg-yellow-500',
        suspended: 'bg-red-500'
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between">
                    <div className="space-y-1">
                        <CardTitle>{tenant.name}</CardTitle>
                        <CardDescription>/{tenant.slug}</CardDescription>
                    </div>
                    <Badge
                        variant={tenant.status === 'active' ? 'default' : 'secondary'}
                        className="capitalize"
                    >
                        {tenant.status}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent>
                <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                    <div className="flex items-center">
                        <span className="font-medium">{userCount}</span>
                        <span className="ml-1">{userCount === 1 ? 'user' : 'users'}</span>
                    </div>
                    <div className="flex items-center">
                        <span>Created {new Date(tenant.createdAt).toLocaleDateString()}</span>
                    </div>
                </div>
            </CardContent>
            {showActions && (
                <CardFooter className="flex justify-between">
                    <Link href={`/admin/tenants/${tenant.id}`}>
                        <Button variant="outline" size="sm">
                            View Details
                        </Button>
                    </Link>
                    <div className="flex gap-2">
                        {onEdit && (
                            <Button variant="ghost" size="sm" onClick={onEdit}>
                                Edit
                            </Button>
                        )}
                        {onDelete && tenant.status !== 'suspended' && (
                            <Button variant="ghost" size="sm" onClick={onDelete}>
                                Suspend
                            </Button>
                        )}
                    </div>
                </CardFooter>
            )}
        </Card>
    )
}
