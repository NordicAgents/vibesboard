import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Better Auth sets this cookie name by default (configurable via cookies plugin).
const SESSION_COOKIE_NAME = 'better-auth.session_token'

// Reserved slugs that cannot be tenant slugs (match app routes)
const RESERVED_SLUGS = new Set([
  'admin',
  'agents',
  'api',
  'chat',
  'invite',
  'landing',
  'privacy-policy',
  'settings',
  'share',
  'sign-in',
  'sign-up',
  'terms-of-service',
  'whatsapp-inbox',
  'instagram-inbox',
  'widget',
  'pricing',
  '_next',
  'public'
])

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const pathname = req.nextUrl.pathname

  // Allow public access to invitation pages
  if (pathname.startsWith('/invite/')) {
    return res
  }

  // Allow public access to widget pages (embedded iframe)
  if (pathname.startsWith('/widget/')) {
    return res
  }

  // Check for session cookie
  const sessionCookie = req.cookies.get(SESSION_COOKIE_NAME)?.value

  // Detect potential /{tenantSlug}/{agentSlug} pattern:
  // Path has exactly 2 segments and the first is not a reserved slug.
  const segments = pathname.split('/').filter(Boolean)
  if (
    segments.length === 2 &&
    !RESERVED_SLUGS.has(segments[0]) &&
    !segments[0].startsWith('_')
  ) {
    // This is a public agent page — allow without auth
    return res
  }

  // Detect /{tenantSlug}/l/{linkSlug} pattern (agent links):
  if (
    segments.length === 3 &&
    !RESERVED_SLUGS.has(segments[0]) &&
    !segments[0].startsWith('_') &&
    segments[1] === 'l'
  ) {
    // This is a public agent link page — allow without auth
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

  if (!sessionCookie && isProtectedRoute) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/sign-in'
    redirectUrl.searchParams.set('redirectedFrom', req.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // For authenticated users, verify session and check RBAC.
  // Full token verification happens in API routes / server components via
  // the auth() helper. In middleware we do a lightweight cookie-presence check
  // and defer to a server-side verification for role-gated routes.
  if (sessionCookie) {
    // We need the Firebase Admin SDK to verify the session cookie and check roles.
    // Edge middleware cannot run firebase-admin (Node.js API), so for admin/settings
    // routes we use a lightweight approach: the session cookie's presence is checked
    // here, and detailed RBAC is enforced in the server component / API route layer.
    //
    // For admin and settings routes, we still allow the request through to the
    // page/route handler which will do the full RBAC check with Firebase Admin.
  }

  return res
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api (API routes — they handle their own auth)
     * - _next/static, _next/image (static files)
     * - favicon.ico
     * - static assets (images, etc.)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg)).*)'
  ]
}
