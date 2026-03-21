'use client'

import { Badge } from '@/components/ui/badge'
import { type Role } from '@/lib/permissions'

interface RoleBadgeProps {
    role: Role
    className?: string
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
    const variants: Record<Role, { variant: 'default' | 'secondary' | 'destructive' | 'outline', label: string }> = {
        SUPER_ADMIN: { variant: 'destructive', label: 'Super Admin' },
        TENANT_ADMIN: { variant: 'default', label: 'Admin' },
        MEMBER: { variant: 'secondary', label: 'Member' }
    }

    const config = variants[role] || { variant: 'outline' as const, label: role }

    return (
        <Badge variant={config.variant} className={className}>
            {config.label}
        </Badge>
    )
}
