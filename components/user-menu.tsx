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
            className="size-9 text-[#8A8A8A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] dark:text-[#A0A0A0] dark:hover:bg-[#2A2A2A] dark:hover:text-[#F0F0F0]"
          >
            <Settings className="size-5" />
            <span className="sr-only">User Settings</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          sideOffset={8}
          align="end"
          className="w-[200px] rounded-xl border border-[#E5E5E5] bg-[#F7F7F5] p-1 shadow-md dark:border-[#2A2A2A] dark:bg-[#141414]"
        >
          <DropdownMenuItem className="flex-col items-start rounded-lg px-3 py-2 focus:bg-[#EFEFED] dark:focus:bg-[#2A2A2A]">
            <div className="text-xs font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
              {user?.name}
            </div>
            <div className="w-full truncate text-xs text-[#8A8A8A] dark:text-[#A0A0A0]">
              {user?.email}
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="my-1 bg-[#E5E5E5] dark:bg-[#2A2A2A]" />
          {canManageTenant && (
            <DropdownMenuItem asChild>
              <Link
                href="/settings/tenant"
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#5A5A5A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] focus:bg-[#EFEFED] focus:text-[#1A1A1A] dark:text-[#8A8A8A] dark:hover:bg-[#2A2A2A] dark:hover:text-[#F0F0F0] dark:focus:bg-[#2A2A2A] dark:focus:text-[#F0F0F0]"
              >
                Tenant Settings
              </Link>
            </DropdownMenuItem>
          )}
          {isSuperAdmin && (
            <DropdownMenuItem asChild>
              <Link
                href="/admin"
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#5A5A5A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] focus:bg-[#EFEFED] focus:text-[#1A1A1A] dark:text-[#8A8A8A] dark:hover:bg-[#2A2A2A] dark:hover:text-[#F0F0F0] dark:focus:bg-[#2A2A2A] dark:focus:text-[#F0F0F0]"
              >
                Super Admin
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={handleSignOut}
            className="cursor-pointer rounded-lg px-3 py-2 text-sm text-[#5A5A5A] hover:bg-[#EFEFED] hover:text-[#1A1A1A] focus:bg-[#EFEFED] focus:text-[#1A1A1A] dark:text-[#8A8A8A] dark:hover:bg-[#2A2A2A] dark:hover:text-[#F0F0F0] dark:focus:bg-[#2A2A2A] dark:focus:text-[#F0F0F0]"
          >
            Log Out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
