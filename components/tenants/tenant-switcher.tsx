'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Database } from '@/lib/db_types'

type Tenant = Database['public']['Tables']['tenants']['Row']

interface TenantSwitcherProps {
    tenants: Tenant[]
    currentTenantId: string | null
    className?: string
}

export function TenantSwitcher({
    tenants,
    currentTenantId,
    className
}: TenantSwitcherProps) {
    const router = useRouter()
    const [open, setOpen] = useState(false)

    const currentTenant = tenants.find(t => t.id === currentTenantId)

    const handleTenantSwitch = async (tenantId: string) => {
        try {
            // Call API to set active tenant
            const response = await fetch('/api/user/active-tenant', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id: tenantId })
            })

            if (response.ok) {
                // Refresh the page to reload with new tenant context
                router.refresh()
                setOpen(false)
            }
        } catch (error) {
            console.error('Failed to switch tenant:', error)
        }
    }

    if (tenants.length === 0) {
        return null
    }

    if (tenants.length === 1) {
        return (
            <div className={cn('flex items-center gap-2 px-3 py-2', className)}>
                <div className="flex flex-col">
                    <span className="text-sm font-medium">{tenants[0].name}</span>
                    <span className="text-xs text-muted-foreground">/{tenants[0].slug}</span>
                </div>
            </div>
        )
    }

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn('justify-between', className)}
                >
                    <div className="flex flex-col items-start">
                        <span className="text-sm font-medium">
                            {currentTenant?.name || 'Select tenant'}
                        </span>
                        {currentTenant && (
                            <span className="text-xs text-muted-foreground">
                                /{currentTenant.slug}
                            </span>
                        )}
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[240px]">
                <DropdownMenuLabel>Switch Tenant</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {tenants.map((tenant) => (
                    <DropdownMenuItem
                        key={tenant.id}
                        onSelect={() => handleTenantSwitch(tenant.id)}
                        className="flex items-center justify-between"
                    >
                        <div className="flex flex-col">
                            <span className="font-medium">{tenant.name}</span>
                            <span className="text-xs text-muted-foreground">/{tenant.slug}</span>
                        </div>
                        {currentTenantId === tenant.id && (
                            <Check className="h-4 w-4" />
                        )}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
