'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Check,
  ChevronsUpDown,
  Loader2,
  Building2,
  User,
  Users
} from 'lucide-react'
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
import type { TenantWithMembers } from '@/lib/tenant-context'
import toast from 'react-hot-toast'

interface TenantSwitcherProps {
  tenants: TenantWithMembers[]
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

  const personalTenants = tenants.filter(t => t.isPersonal)
  const orgTenants = tenants.filter(t => !t.isPersonal)

  const getMemberLabel = (tenant: TenantWithMembers) => {
    if (tenant.isPersonal) {
      const owner = tenant.members[0]
      return owner?.email || owner?.name || null
    }
    if (tenant.memberCount === 0) return null
    const names = tenant.members
      .slice(0, 2)
      .map(m => m.name || m.email || 'Unknown')
    if (tenant.memberCount > 2) {
      return `${names.join(', ')} +${tenant.memberCount - 2}`
    }
    return names.join(', ')
  }

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
        window.dispatchEvent(new CustomEvent('tenantChanged', { detail: { tenantId } }))
        setOpen(false)
      } else {
        toast.error('Failed to switch workspace. Please try again.')
      }
    } catch (error) {
      console.error('Failed to switch workspace:', error)
      toast.error('Unable to switch workspace right now.')
    } finally {
      setIsSwitching(false)
    }
  }

  if (tenants.length === 0) return null
  if (tenants.length === 1) return null

  const TenantIcon = currentTenant?.isPersonal ? User : Building2

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Switch active workspace"
          className={cn(
            'h-auto w-full justify-between rounded-lg px-3 py-2 hover:bg-[#e6ede6] dark:hover:bg-[#344348]',
            className
          )}
          disabled={isSwitching}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-md',
                currentTenant?.isPersonal
                  ? 'bg-[#e8e6ed] dark:bg-[#3a3448]'
                  : 'bg-[#e6ede6] dark:bg-[#344348]'
              )}
            >
              <TenantIcon className="size-3.5 text-accent-orange" />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
                {currentTenant
                  ? currentTenant.isPersonal
                    ? 'Personal'
                    : currentTenant.name
                  : 'Select workspace'}
              </span>
              {currentTenant && (
                <span className="truncate text-[11px] text-[#6f7f80]">
                  {currentTenant.isPersonal
                    ? currentTenant.members[0]?.email || 'Personal workspace'
                    : `${currentTenant.memberCount} member${currentTenant.memberCount !== 1 ? 's' : ''}`}
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
        className="w-[280px] rounded-xl border-[#e4e3e3] bg-[#f5f8f7] shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:border-[#344348] dark:bg-[#192425]"
      >
        {/* Personal workspaces */}
        {personalTenants.length > 0 && (
          <>
            <DropdownMenuLabel className="label-caps px-3 py-2 flex items-center gap-1.5">
              <User className="size-3 text-[#6f7f80]" />
              Personal
            </DropdownMenuLabel>
            {personalTenants.map(tenant => (
              <TenantItem
                key={tenant.id}
                tenant={tenant}
                isActive={currentTenantId === tenant.id}
                memberLabel={getMemberLabel(tenant)}
                onSelect={() => handleTenantSwitch(tenant.id)}
                isPersonal
              />
            ))}
          </>
        )}

        {/* Separator between sections */}
        {personalTenants.length > 0 && orgTenants.length > 0 && (
          <DropdownMenuSeparator className="bg-[#e4e3e3] dark:bg-[#344348]" />
        )}

        {/* Organization workspaces */}
        {orgTenants.length > 0 && (
          <>
            <DropdownMenuLabel className="label-caps px-3 py-2 flex items-center gap-1.5">
              <Building2 className="size-3 text-[#6f7f80]" />
              Organizations
            </DropdownMenuLabel>
            {orgTenants.map(tenant => (
              <TenantItem
                key={tenant.id}
                tenant={tenant}
                isActive={currentTenantId === tenant.id}
                memberLabel={getMemberLabel(tenant)}
                onSelect={() => handleTenantSwitch(tenant.id)}
                isPersonal={false}
              />
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function TenantItem({
  tenant,
  isActive,
  memberLabel,
  onSelect,
  isPersonal
}: {
  tenant: TenantWithMembers
  isActive: boolean
  memberLabel: string | null
  onSelect: () => void
  isPersonal: boolean
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className="mx-1 flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 hover:bg-[#e6ede6] focus:bg-[#e6ede6] dark:hover:bg-[#344348] dark:focus:bg-[#344348]"
    >
      <div
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md',
          isPersonal
            ? 'bg-[#e8e6ed] dark:bg-[#3a3448]'
            : 'bg-[#e6ede6] dark:bg-[#344348]'
        )}
      >
        {isPersonal ? (
          <User className="size-3.5 text-[#6f7f80]" />
        ) : (
          <Building2 className="size-3.5 text-accent-orange" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium text-[#222f30] dark:text-[#f5f8f7]">
          {isPersonal ? 'Personal' : tenant.name}
        </span>
        {memberLabel && (
          <span className="truncate text-[11px] text-[#6f7f80]">
            {memberLabel}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!isPersonal && tenant.memberCount > 0 && (
          <span className="flex items-center gap-0.5 rounded-full bg-[#e6ede6] px-1.5 py-0.5 text-[10px] font-medium text-[#445e5f] dark:bg-[#344348] dark:text-[#6f7f80]">
            <Users className="size-2.5" />
            {tenant.memberCount}
          </span>
        )}
        {isActive && <Check className="size-3.5 text-accent-orange" />}
      </div>
    </DropdownMenuItem>
  )
}
