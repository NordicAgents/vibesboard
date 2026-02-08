import { createMiddlewareClient } from '@supabase/auth-helpers-nextjs'
import { NextResponse } from 'next/server'

import type { NextRequest } from 'next/server'

type GlobalRole = 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'

// Derive a user's highest role and an active tenant from tenant_users
async function getUserPermissions(
  supabase: any,
  userId: string
): Promise<{ role: GlobalRole | null; tenantId: string | null }> {
  const { data, error } = await supabase
    .from('tenant_users')
    .select('role, tenant_id')
    .eq('user_id', userId)

  if (error || !data || data.length === 0) {
    return { role: null, tenantId: null }
  }

  const roles = data.map((row: { role: string }) => row.role)
  const tenantId = data[0].tenant_id

  if (roles.includes('SUPER_ADMIN')) return { role: 'SUPER_ADMIN', tenantId }
  if (roles.includes('TENANT_ADMIN')) return { role: 'TENANT_ADMIN', tenantId }
  if (roles.includes('MEMBER')) return { role: 'MEMBER', tenantId }

  return { role: null, tenantId }
}

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()

  // Create a Supabase client configured to use cookies
  const supabase = createMiddlewareClient({ req, res })

  // Refresh session if expired - required for Server Components
  // https://supabase.com/docs/guides/auth/auth-helpers/nextjs#managing-session-with-middleware
  const {
    data: { session }
  } = await supabase.auth.getSession()

  const pathname = req.nextUrl.pathname

  // Allow public access to invitation pages
  if (pathname.startsWith('/invite/')) {
    return res
  }

  // Check if user is authenticated for protected routes
  const isProtectedRoute =
    !pathname.includes('/sign-in') &&
    !pathname.includes('/sign-up') &&
    !pathname.includes('/landing') &&
    !pathname.includes('/privacy-policy') &&
    !pathname.includes('/terms-of-service') &&
    pathname !== '/'

  if (!session && isProtectedRoute) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/sign-in'
    redirectUrl.searchParams.set(`redirectedFrom`, req.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // Role-based access control
  if (session?.user?.id) {
    const { role: userRole, tenantId } = await getUserPermissions(
      supabase,
      session.user.id
    )

    // Protect /admin/* routes - SUPER_ADMIN only
    if (pathname.startsWith('/admin')) {
      if (userRole !== 'SUPER_ADMIN') {
        return NextResponse.redirect(new URL('/', req.url))
      }
    }

    // Protect /settings/* routes - TENANT_ADMIN or SUPER_ADMIN
    if (pathname.startsWith('/settings')) {
      if (userRole !== 'TENANT_ADMIN' && userRole !== 'SUPER_ADMIN') {
        return NextResponse.redirect(new URL('/', req.url))
      }
    }

    // Inject active tenant ID in response headers for easy access
    if (tenantId) {
      res.headers.set('x-tenant-id', tenantId)
    }
  }

  return res
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - share (publicly shared chats)
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    // Allow public anonymous agent pages under `/a/*`
    '/((?!a/|share|api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)).*)'
  ]
}
