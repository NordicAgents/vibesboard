'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronsUpDown, Loader2, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { TenantDocument } from '@/lib/firestore-types'
import toast from 'react-hot-toast'

interface TenantSwitcherProps {
  tenants: TenantDocument[]
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

  const getTenantName = (tenant: TenantDocument) =>
    tenant.isPersonal ? 'Personal Workspace' : tenant.name

  const getTenantSlugLabel = (tenant: TenantDocument) =>
    tenant.isPersonal ? null : `/${tenant.slug}`

  const handleTenantSwitch = async (tenantId: string) => {
    try {
      setIsSwitching(true)
      const response = await fetch('/api/user/active-tenant', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId })
      })

      if (response.ok) {
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
    return null
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch active tenant"
          className={cn(
            'h-auto w-full justify-between rounded-lg px-3 py-2 hover:bg-[#e6ede6] dark:hover:bg-[#344348]',
            className
          )}
          disabled={isSwitching}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#e6ede6] dark:bg-[#344348]">
              <Building2 className="size-3.5 text-accent-orange" />
            </div>
            <div className="flex min-w-0 flex-col items-start">
              <span className="truncate text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
                {currentTenant
                  ? getTenantName(currentTenant)
                  : 'Select workspace'}
              </span>
              {currentTenant && getTenantSlugLabel(currentTenant) && (
                <span className="text-[11px] text-[#6f7f80]">
                  {getTenantSlugLabel(currentTenant)}
                </span>
              )}
            </div>
          </div>
          {isSwitching ? (
            <Loader2
              className="ml-2 size-3.5 shrink-0 animate-spin text-[#6f7f80]"
              aria-hidden
            />
          ) : (
            <ChevronsUpDown
              className="ml-2 size-3.5 shrink-0 text-[#6f7f80]"
              aria-hidden
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[240px] rounded-xl border-[#e4e3e3] bg-[#f5f8f7] shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:border-[#344348] dark:bg-[#192425]"
      >
        <DropdownMenuLabel className="label-caps px-3 py-2">
          Switch Workspace
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-[#e4e3e3] dark:bg-[#344348]" />
        {tenants.map(tenant => (
          <DropdownMenuItem
            key={tenant.id}
            onSelect={() => handleTenantSwitch(tenant.id)}
            className="mx-1 flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 hover:bg-[#e6ede6] focus:bg-[#e6ede6] dark:hover:bg-[#344348] dark:focus:bg-[#344348]"
          >
            <div className="flex flex-col">
              <span className="text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
                {getTenantName(tenant)}
              </span>
              {getTenantSlugLabel(tenant) && (
                <span className="text-[11px] text-[#6f7f80]">
                  {getTenantSlugLabel(tenant)}
                </span>
              )}
            </div>
            {currentTenantId === tenant.id && (
              <Check className="size-3.5 text-accent-orange" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
