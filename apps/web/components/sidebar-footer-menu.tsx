'use client'

import * as React from 'react'
import { useTheme } from 'next-themes'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Moon, Sun, Building2, Shield, LogOut } from 'lucide-react'

import { authClient } from '@/lib/auth-client'
import {
  DropdownMenuItem,
  DropdownMenuLabel
} from '@/components/ui/dropdown-menu'

export interface SidebarFooterMenuProps {
  user: {
    id: string
    email?: string | null
    name?: string | null
    image?: string | null
  }
  isSuperAdmin?: boolean
  canManageTenant?: boolean
}

const itemClass =
  'mx-1 cursor-pointer rounded-lg px-3 py-2.5 text-sm text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] focus:bg-[#e6ede6] focus:text-[#222f30] dark:text-[#c9cbbe] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7] dark:focus:bg-[#344348] dark:focus:text-[#f5f8f7]'

/**
 * Footer actions (theme toggle + user-settings menu) rendered as items inside
 * the workspace switcher's dropdown. Pass to <TenantSwitcher extraContent />.
 */
export function SidebarFooterMenu({
  user,
  isSuperAdmin,
  canManageTenant
}: SidebarFooterMenuProps) {
  const router = useRouter()
  const { setTheme, theme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    setMounted(true)
  }, [])

  const isDarkMode = theme === 'dark'

  const handleSignOut = async () => {
    await authClient.signOut()
    router.refresh()
  }

  return (
    <>
      <DropdownMenuLabel className="px-3 py-2">
        <div className="text-xs font-medium text-[#222f30] dark:text-[#f5f8f7]">
          {user?.name}
        </div>
        <div className="w-full truncate text-xs font-normal text-[#6f7f80] dark:text-[#c9cbbe]">
          {user?.email}
        </div>
      </DropdownMenuLabel>

      {canManageTenant && (
        <DropdownMenuItem asChild>
          <Link href="/settings/tenant" className={`flex items-center gap-2.5 ${itemClass}`}>
            <Building2 className="size-4 text-[#6f7f80]" />
            <span className="font-medium">Workspace settings</span>
          </Link>
        </DropdownMenuItem>
      )}

      {isSuperAdmin && (
        <DropdownMenuItem asChild>
          <Link href="/admin" className={`flex items-center gap-2.5 ${itemClass}`}>
            <Shield className="size-4 text-[#6f7f80]" />
            <span className="font-medium">Super Admin</span>
          </Link>
        </DropdownMenuItem>
      )}

      {/* Theme toggle — keep the menu open so it can be toggled repeatedly */}
      {mounted && (
        <DropdownMenuItem
          onSelect={e => {
            e.preventDefault()
            setTheme(isDarkMode ? 'light' : 'dark')
          }}
          className={`flex items-center gap-2.5 ${itemClass}`}
        >
          {isDarkMode ? (
            <Sun className="size-4 text-[#6f7f80]" />
          ) : (
            <Moon className="size-4 text-[#6f7f80]" />
          )}
          <span className="font-medium">
            {isDarkMode ? 'Light mode' : 'Dark mode'}
          </span>
        </DropdownMenuItem>
      )}

      <DropdownMenuItem
        onClick={handleSignOut}
        className={`flex items-center gap-2.5 ${itemClass}`}
      >
        <LogOut className="size-4 text-[#6f7f80]" />
        <span className="font-medium">Log out</span>
      </DropdownMenuItem>
    </>
  )
}
