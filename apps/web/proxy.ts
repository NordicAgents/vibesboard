import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'

// Better Auth's session cookie. On secure (HTTPS) connections it is prefixed
// with `__Secure-`; on plain http (local dev) it is not. Check both so the
// proxy recognizes the session in production as well as locally.
const SESSION_COOKIE_NAMES = [
  '__Secure-better-auth.session_token',
  'better-auth.session_token'
] as const

// Reserved slugs that cannot be tenant slugs (match app routes)
const RESERVED_SLUGS = new Set([
  'admin',
  'agents',
  'api',
  'chat',
  'docs',
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

export function buildContentSecurityPolicy(
  nonce: string,
  options: { widget: boolean; development: boolean }
): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(options.development ? ["'unsafe-eval'"] : [])
  ].join(' ')

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Next, Radix, and the embedded widget currently emit inline style
    // attributes. Script execution remains nonce-bound; styles are not an
    // executable trust boundary in modern browsers.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "frame-src 'self' https:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: https:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${options.widget ? '*' : "'self'"}`,
    ...(options.development ? [] : ['upgrade-insecure-requests'])
  ].join('; ')
}

function secureNextResponse(req: NextRequest, nonce: string) {
  const requestHeaders = new Headers(req.headers)
  const csp = buildContentSecurityPolicy(nonce, {
    widget: req.nextUrl.pathname.startsWith('/widget/'),
    development: process.env.NODE_ENV !== 'production'
  })
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export async function proxy(req: NextRequest) {
  const nonce = randomBytes(16).toString('base64')
  const res = secureNextResponse(req, nonce)
  const pathname = req.nextUrl.pathname

  // Allow public access to invitation pages
  if (pathname.startsWith('/invite/')) {
    return res
  }

  // Allow public access to widget pages (embedded iframe)
  if (pathname.startsWith('/widget/')) {
    return res
  }

  // Allow public access to the documentation site
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return res
  }

  // Check for session cookie (secure-prefixed in prod, plain in local dev)
  const sessionCookie = SESSION_COOKIE_NAMES.map(
    name => req.cookies.get(name)?.value
  ).find(Boolean)

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
    !pathname.includes('/forgot-password') &&
    !pathname.includes('/reset-password') &&
    !pathname.includes('/landing') &&
    !pathname.includes('/privacy-policy') &&
    !pathname.includes('/terms-of-service') &&
    pathname !== '/'

  if (!sessionCookie && isProtectedRoute) {
    const redirectUrl = req.nextUrl.clone()
    redirectUrl.pathname = '/sign-in'
    redirectUrl.searchParams.set('redirectedFrom', req.nextUrl.pathname)
    const redirect = NextResponse.redirect(redirectUrl)
    redirect.headers.set(
      'Content-Security-Policy',
      buildContentSecurityPolicy(nonce, {
        widget: false,
        development: process.env.NODE_ENV !== 'production'
      })
    )
    return redirect
  }

  // For authenticated users, verify session and check RBAC.
  // Full token verification happens in API routes / server components via
  // the auth() helper. In middleware we do a lightweight cookie-presence check
  // and defer to a server-side verification for role-gated routes.
  if (sessionCookie) {
    // Verifying the session + roles requires DB/Node APIs that the proxy
    // cannot run, so for admin/settings routes we use a lightweight approach:
    // the session cookie's presence is checked
    // here, and detailed RBAC is enforced in the server component / API route layer.
    //
    // For admin and settings routes, we still allow the request through to the
    // page/route handler which will do the full RBAC check server-side.
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
