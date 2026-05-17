'use client'

import { signOut } from 'firebase/auth'
import { getClientAuth } from '@vibesboard/adapter-firebase/client'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

export interface UserMenuProps {
  user: {
    id: string
    email?: string
    name?: string
    image?: string
  }
  isSuperAdmin?: boolean
  canManageTenant?: boolean
}

export function UserMenu({
  user,
  isSuperAdmin,
  canManageTenant
}: UserMenuProps) {
  const router = useRouter()

  const handleSignOut = async () => {
    // Sign out from Firebase client
    const auth = getClientAuth()
    await signOut(auth)

    // Clear the server-side session cookie
    await fetch('/api/auth/session', { method: 'DELETE' })

    router.refresh()
  }

  return (
    <div className="flex items-center justify-between">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 text-[#6f7f80] hover:bg-[#e6ede6] hover:text-[#222f30] dark:text-[#c9cbbe] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7]"
          >
            <Settings className="size-5" />
            <span className="sr-only">User Settings</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sideOffset={8}
          align="end"
          className="w-[200px] rounded-xl border border-[#e4e3e3] bg-[#f5f8f7] p-1 shadow-md dark:border-[#344348] dark:bg-[#192425]"
        >
          <DropdownMenuItem className="flex-col items-start rounded-lg px-3 py-2 focus:bg-[#e6ede6] dark:focus:bg-[#344348]">
            <div className="text-xs font-medium text-[#222f30] dark:text-[#f5f8f7]">
              {user?.name}
            </div>
            <div className="w-full truncate text-xs text-[#6f7f80] dark:text-[#c9cbbe]">
              {user?.email}
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-[#e4e3e3] dark:bg-[#344348]" />
          {canManageTenant && (
            <DropdownMenuItem asChild>
              <Link
                href="/settings/tenant"
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] focus:bg-[#e6ede6] focus:text-[#222f30] dark:text-[#6f7f80] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7] dark:focus:bg-[#344348] dark:focus:text-[#f5f8f7]"
              >
                Tenant Settings
              </Link>
            </DropdownMenuItem>
          )}
          {isSuperAdmin && (
            <DropdownMenuItem asChild>
              <Link
                href="/admin"
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] focus:bg-[#e6ede6] focus:text-[#222f30] dark:text-[#6f7f80] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7] dark:focus:bg-[#344348] dark:focus:text-[#f5f8f7]"
              >
                Super Admin
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={handleSignOut}
            className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#445e5f] hover:bg-[#e6ede6] hover:text-[#222f30] focus:bg-[#e6ede6] focus:text-[#222f30] dark:text-[#6f7f80] dark:hover:bg-[#344348] dark:hover:text-[#f5f8f7] dark:focus:bg-[#344348] dark:focus:text-[#f5f8f7]"
          >
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
