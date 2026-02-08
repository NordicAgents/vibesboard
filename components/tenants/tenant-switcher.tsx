'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
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
import toast from 'react-hot-toast'

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
    const [isSwitching, setIsSwitching] = useState(false)

    const currentTenant = tenants.find(t => t.id === currentTenantId)

    const getTenantName = (tenant: Tenant) =>
        tenant.is_personal ? 'Personal Workspace' : tenant.name

    const getTenantSlugLabel = (tenant: Tenant) =>
        tenant.is_personal ? null : `/${tenant.slug}`

    const handleTenantSwitch = async (tenantId: string) => {
        try {
            setIsSwitching(true)
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
            } else {
                toast.error('Failed to switch tenant. Please try again.')
            }
        } catch (error) {
            console.error('Failed to switch tenant:', error)
            toast.error('Unable to switch tenant right now.')
        } finally {
            setIsSwitching(false)
        }
    }

    if (tenants.length === 0) {
        return null
    }

    if (tenants.length === 1) {
        const onlyTenant = tenants[0]
        return (
            <div className={cn('flex items-center gap-2 px-3 py-2', className)}>
                <div className="flex flex-col">
                    <span className="text-sm font-medium">{getTenantName(onlyTenant)}</span>
                    {getTenantSlugLabel(onlyTenant) && (
                        <span className="text-xs text-muted-foreground">{getTenantSlugLabel(onlyTenant)}</span>
                    )}
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
                    aria-label="Switch active tenant"
                    className={cn('justify-between', className)}
                    disabled={isSwitching}
                >
                    <div className="flex flex-col items-start">
                        <span className="text-sm font-medium">
                            {currentTenant ? getTenantName(currentTenant) : 'Select tenant'}
                        </span>
                        {currentTenant && getTenantSlugLabel(currentTenant) && (
                            <span className="text-xs text-muted-foreground">
                                {getTenantSlugLabel(currentTenant)}
                            </span>
                        )}
                    </div>
                    {isSwitching ? (
                        <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-70" aria-hidden />
                    ) : (
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden />
                    )}
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
                            <span className="font-medium">{getTenantName(tenant)}</span>
                            {getTenantSlugLabel(tenant) && (
                                <span className="text-xs text-muted-foreground">{getTenantSlugLabel(tenant)}</span>
                            )}
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
