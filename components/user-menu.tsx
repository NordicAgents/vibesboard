'use client'

import { signOut } from 'firebase/auth'
import { getClientAuth } from '@/lib/firebase/client'
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
            className="size-9 text-[#9D9790] hover:bg-[#EDE8DE] hover:text-[#1A1915] dark:text-[#6B6560] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8]"
          >
            <Settings className="size-5" />
            <span className="sr-only">User Settings</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sideOffset={8}
          align="end"
          className="w-[200px] rounded-xl border border-[#E2DDD4] bg-[#FDFAF5] p-1 shadow-md dark:border-[#2E2B25] dark:bg-[#221F1A]"
        >
          <DropdownMenuItem className="flex-col items-start rounded-lg px-3 py-2 focus:bg-[#EDE8DE] dark:focus:bg-[#2E2B25]">
            <div className="text-xs font-medium text-[#1A1915] dark:text-[#E8E3D8]">
              {user?.name}
            </div>
            <div className="w-full truncate text-xs text-[#9D9790]">
              {user?.email}
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-[#E2DDD4] dark:bg-[#2E2B25]" />
          {canManageTenant && (
            <DropdownMenuItem asChild>
              <Link
                href="/settings/tenant"
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] focus:bg-[#EDE8DE] focus:text-[#1A1915] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8] dark:focus:bg-[#2E2B25] dark:focus:text-[#E8E3D8]"
              >
                Tenant Settings
              </Link>
            </DropdownMenuItem>
          )}
          {isSuperAdmin && (
            <DropdownMenuItem asChild>
              <Link
                href="/admin"
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] focus:bg-[#EDE8DE] focus:text-[#1A1915] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8] dark:focus:bg-[#2E2B25] dark:focus:text-[#E8E3D8]"
              >
                Super Admin
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={handleSignOut}
            className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#6B6560] hover:bg-[#EDE8DE] hover:text-[#1A1915] focus:bg-[#EDE8DE] focus:text-[#1A1915] dark:text-[#9D9790] dark:hover:bg-[#2E2B25] dark:hover:text-[#E8E3D8] dark:focus:bg-[#2E2B25] dark:focus:text-[#E8E3D8]"
          >
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
