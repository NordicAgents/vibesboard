# Security Remediation Guide

**Project:** VibeAgent - Multi-Tenant AI Chat Application  
**Date:** December 27, 2025  
**Priority Levels:** P0 (Immediate) | P1 (This Week) | P2 (This Month) | P3 (Backlog)

---

## Quick Reference: Fix Priority Matrix

| Issue | Priority | Effort | Impact |
|-------|----------|--------|--------|
| Add Rate Limiting | P0 | Medium | Critical |
| Add Content Security Policy | P0 | Low | Critical |
| Fix Service Role Key Usage | P1 | High | Critical |
| Add SSRF Protection | P1 | Low | High |
| Enforce Invitation Email Match | P1 | Low | Medium |
| Add CORS Configuration | P1 | Low | High |
| Secure Smoke Test Endpoint | P2 | Low | Medium |
| Add Audit Logging | P2 | Medium | Medium |
| Scan Dependencies | P2 | Low | Medium |
| Add Security Headers | P2 | Low | Medium |

---

## P0: Immediate Fixes (Critical)

### 1. Implement Rate Limiting

**Issue:** No rate limiting allows API abuse and cost exploitation.

**Solution Options:**

#### Option A: Upstash Rate Limit (Recommended for serverless)

```bash
npm install @upstash/ratelimit @upstash/redis
```

Create `lib/rate-limit.ts`:

```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Create Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// Rate limiters for different endpoints
export const chatRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '1 m'), // 10 requests per minute
  analytics: true,
  prefix: 'rl:chat',
})

export const publicChatRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'), // 5 requests per minute for public
  analytics: true,
  prefix: 'rl:public-chat',
})

export const apiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 requests per minute
  analytics: true,
  prefix: 'rl:api',
})

export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string
): Promise<{ success: boolean; remaining: number; reset: number }> {
  const { success, remaining, reset } = await limiter.limit(identifier)
  return { success, remaining, reset }
}
```

Update API routes (example for `app/api/public/agents/[slug]/chat/route.ts`):

```typescript
import { publicChatRateLimit, checkRateLimit } from '@/lib/rate-limit'
import { headers } from 'next/headers'

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  // Get client IP for rate limiting
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0] ?? 
             headersList.get('x-real-ip') ?? 
             'anonymous'
  
  // Check rate limit
  const { success, remaining, reset } = await checkRateLimit(publicChatRateLimit, ip)
  
  if (!success) {
    return new NextResponse('Too Many Requests', {
      status: 429,
      headers: {
        'X-RateLimit-Remaining': remaining.toString(),
        'X-RateLimit-Reset': reset.toString(),
        'Retry-After': Math.ceil((reset - Date.now()) / 1000).toString(),
      },
    })
  }
  
  // ... rest of the handler
}
```

#### Option B: In-Memory Rate Limiting (Simple, non-distributed)

Create `lib/simple-rate-limit.ts`:

```typescript
const requests = new Map<string, { count: number; resetAt: number }>()

export function simpleRateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number } {
  const now = Date.now()
  const record = requests.get(identifier)
  
  if (!record || record.resetAt < now) {
    requests.set(identifier, { count: 1, resetAt: now + windowMs })
    return { success: true, remaining: limit - 1 }
  }
  
  if (record.count >= limit) {
    return { success: false, remaining: 0 }
  }
  
  record.count++
  return { success: true, remaining: limit - record.count }
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, value] of requests.entries()) {
    if (value.resetAt < now) {
      requests.delete(key)
    }
  }
}, 60000)
```

---

### 2. Add Content Security Policy

**Issue:** No CSP header allows XSS and injection attacks.

**Solution:** Update `next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // Needed for Next.js
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data:",
              "connect-src 'self' https://api.openai.com https://*.supabase.co wss://*.supabase.co",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; ')
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          }
        ]
      }
    ]
  },
  
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.githubusercontent.com' },
      { protocol: 'https', hostname: '**.googleusercontent.com' }
    ]
  },
  serverExternalPackages: ['pdf-parse', '@napi-rs/canvas']
}

module.exports = nextConfig
```

---

### 3. Protect Smoke Test Endpoint

**Issue:** `/api/smoke` is publicly accessible and consumes API credits.

**Solution:** Add authentication or environment check:

```typescript
// app/api/smoke/route.ts
export async function GET(req: Request) {
  // Only allow in development or with secret header
  const authHeader = req.headers.get('x-smoke-secret')
  const isAllowed = 
    process.env.NODE_ENV === 'development' ||
    authHeader === process.env.SMOKE_TEST_SECRET
  
  if (!isAllowed) {
    return new NextResponse('Forbidden', { status: 403 })
  }
  
  // ... rest of handler
}
```

Add to `.env.example`:
```
SMOKE_TEST_SECRET=your-secret-here
```

---

## P1: High Priority Fixes (This Week)

### 4. Add SSRF Protection

**Issue:** URL fetching can access internal resources.

**Solution:** Create `lib/url-validator.ts`:

```typescript
import { URL } from 'url'

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal', // GCP metadata
  'metadata',
])

const BLOCKED_IP_PATTERNS = [
  /^10\./,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,  // 172.16.0.0/12
  /^192\.168\./,              // 192.168.0.0/16
  /^169\.254\./,              // Link-local
  /^127\./,                   // Loopback
  /^0\./,                     // 0.0.0.0/8
  /^fc00:/i,                  // IPv6 private
  /^fe80:/i,                  // IPv6 link-local
]

export function isUrlSafe(urlString: string): { safe: boolean; reason?: string } {
  try {
    const url = new URL(urlString)
    
    // Check protocol
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { safe: false, reason: 'Invalid protocol' }
    }
    
    // Check hostname
    const hostname = url.hostname.toLowerCase()
    
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      return { safe: false, reason: 'Blocked hostname' }
    }
    
    // Check IP patterns
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        return { safe: false, reason: 'Internal IP address' }
      }
    }
    
    // Check for localhost variants
    if (hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      return { safe: false, reason: 'Local hostname' }
    }
    
    return { safe: true }
  } catch {
    return { safe: false, reason: 'Invalid URL' }
  }
}
```

Update `lib/agent/tools/builtin.ts`:

```typescript
import { isUrlSafe } from '@/lib/url-validator'

const webFetchFactory: ToolFactory = ({ tool }) => {
  // ...
  execute: async (args: Record<string, any>) => {
    const url = String(args?.url ?? '').trim()
    if (!url) return 'No URL provided.'
    
    const urlCheck = isUrlSafe(url)
    if (!urlCheck.safe) {
      return `URL blocked: ${urlCheck.reason}`
    }
    
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'VibeAgent/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      // ...
    } catch (error) {
      return `Error fetching ${url}: ${error}`
    }
  }
}
```

---

### 5. Enforce Invitation Email Match

**Issue:** Any user can accept any invitation token.

**Solution:** Update `app/api/invitations/[token]/accept/route.ts`:

```typescript
export async function POST(req: Request, { params }: RouteParams) {
  // ... existing auth check ...
  
  const { token } = await params
  
  // Get user's email
  const userEmail = session.user.email?.toLowerCase()
  if (!userEmail) {
    return NextResponse.json(
      { error: 'User email not available' },
      { status: 400 }
    )
  }
  
  // Get invitation
  const { data: invitation, error: inviteError } = await supabase
    .from('invitations')
    .select('*')
    .eq('token', token)
    .single()
  
  if (inviteError || !invitation) {
    return NextResponse.json(
      { error: 'Invitation not found' },
      { status: 404 }
    )
  }
  
  // Verify email matches
  if (invitation.email.toLowerCase() !== userEmail) {
    return NextResponse.json(
      { error: 'This invitation was sent to a different email address' },
      { status: 403 }
    )
  }
  
  // ... rest of acceptance logic ...
}
```

---

### 6. Add CORS Configuration

**Solution:** Update `next.config.js`:

```javascript
const nextConfig = {
  // ...existing config...
  
  async headers() {
    return [
      {
        // API routes
        source: '/api/:path*',
        headers: [
          {
            key: 'Access-Control-Allow-Origin',
            value: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
          },
          {
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, PUT, DELETE, PATCH, OPTIONS'
          },
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, Authorization, X-Requested-With'
          },
          {
            key: 'Access-Control-Allow-Credentials',
            value: 'true'
          }
        ]
      },
      // ... other headers ...
    ]
  }
}
```

---

### 7. Minimize Service Role Key Usage

**Issue:** Service role key bypasses RLS and is a high-value target.

**Solution:** Refactor to use authenticated client where possible:

```typescript
// lib/supabase/server.ts - Update to use session-based client for most operations

import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/db_types'

// Use this for authenticated operations (respects RLS)
export async function createAuthenticatedClient() {
  const cookieStore = await cookies()
  return createServerComponentClient<Database>({
    cookies: () => cookieStore as unknown as ReturnType<typeof cookies>
  })
}

// Keep service client for specific admin operations only
// Document each usage and review regularly
```

Create audit documentation:

```typescript
// lib/supabase/service-client.ts
/**
 * SERVICE ROLE CLIENT - SECURITY CRITICAL
 * 
 * This client bypasses Row Level Security. Only use for:
 * 1. Scheduled jobs/cron tasks
 * 2. Admin operations that require cross-tenant access
 * 3. System-level data migrations
 * 
 * NEVER use for user-initiated requests unless absolutely necessary.
 * 
 * Current approved usages:
 * - lib/agent/file-search.ts: File chunk management (needs review)
 * - app/api/public/agents/[slug]/chat: Public chat (needs review)
 */
```

---

## P2: Medium Priority Fixes (This Month)

### 8. Add Audit Logging

**Solution:** Create `lib/audit-log.ts`:

```typescript
import { createServerClient } from '@/lib/supabase/server'

interface AuditEvent {
  action: string
  userId: string
  tenantId?: string
  resourceType: string
  resourceId?: string
  metadata?: Record<string, any>
  ipAddress?: string
}

export async function logAuditEvent(event: AuditEvent) {
  const supabase = await createServerClient()
  
  const { error } = await supabase
    .from('audit_logs')
    .insert({
      action: event.action,
      user_id: event.userId,
      tenant_id: event.tenantId,
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      metadata: event.metadata,
      ip_address: event.ipAddress,
      created_at: new Date().toISOString()
    })
  
  if (error) {
    console.error('Failed to log audit event:', error)
  }
}

// Helper for common events
export const AuditActions = {
  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  TENANT_DELETED: 'tenant.deleted',
  USER_INVITED: 'user.invited',
  USER_JOINED: 'user.joined',
  USER_REMOVED: 'user.removed',
  USER_ROLE_CHANGED: 'user.role_changed',
  AGENT_CREATED: 'agent.created',
  AGENT_UPDATED: 'agent.updated',
  AGENT_DELETED: 'agent.deleted',
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILURE: 'auth.login_failure',
} as const
```

Migration for audit logs table:

```sql
-- supabase/migrations/YYYYMMDD_audit_logs.sql

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  user_id uuid references auth.users(id) on delete set null,
  tenant_id uuid references public.tenants(id) on delete set null,
  resource_type text not null,
  resource_id text,
  metadata jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_user_id on public.audit_logs(user_id);
create index idx_audit_logs_tenant_id on public.audit_logs(tenant_id);
create index idx_audit_logs_action on public.audit_logs(action);
create index idx_audit_logs_created_at on public.audit_logs(created_at);

-- RLS: Only super admins can read audit logs
alter table public.audit_logs enable row level security;

create policy audit_logs_super_admin_read
  on public.audit_logs
  for select
  to authenticated
  using (
    exists (
      select 1 from public.tenant_users
      where user_id = auth.uid() and role = 'SUPER_ADMIN'
    )
  );
```

---

### 9. Dependency Security Scanning

**Solution:** Add npm audit to CI/CD:

```yaml
# .github/workflows/security.yml
name: Security Scan

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * *'  # Daily

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run npm audit
        run: npm audit --audit-level=moderate
      
      - name: Run Snyk scan
        uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
```

Update specific vulnerable packages:

```bash
# Update packages with known issues
npm update xlsx mammoth jsdom pdf-parse

# Consider replacing openai-edge with official SDK
npm uninstall openai-edge
npm install openai
```

---

### 10. Sanitize SQL Pattern Characters

**Issue:** ilike query may behave unexpectedly with special characters.

**Solution:** Update `lib/agent/file-search.ts`:

```typescript
// Escape special SQL pattern characters
function escapeSqlPattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
}

// In searchAgentFileChunks function:
const textFallback = await supabase
  .from('agent_file_chunks')
  .select('file_key,file_name,content')
  .eq('agent_id', agentId)
  .ilike('content', `%${escapeSqlPattern(query)}%`)
  .limit(limit)
```

---

### 11. Fix Open Redirect Vulnerability

**Solution:** Update `app/api/auth/callback/route.ts`:

```typescript
const ALLOWED_ORIGINS = new Set([
  process.env.NEXT_PUBLIC_APP_URL,
  'http://localhost:3000',
  'http://localhost:8080',
].filter(Boolean))

export async function GET(request: Request) {
  // ... existing code ...
  
  // Validate the constructed origin
  const origin = (protocol && host
    ? `${protocol}://${host}`
    : process.env.NEXT_PUBLIC_APP_URL) ?? 'http://localhost:3000'
  
  // Check if origin is allowed
  const originUrl = new URL(origin)
  const isAllowed = ALLOWED_ORIGINS.has(origin) || 
    ALLOWED_ORIGINS.has(`${originUrl.protocol}//${originUrl.host}`)
  
  if (!isAllowed) {
    console.warn(`Blocked redirect to unauthorized origin: ${origin}`)
    return NextResponse.redirect(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')
  }
  
  return NextResponse.redirect(origin)
}
```

---

### 12. Remove Tenant ID from Response Headers

**Solution:** Update `middleware.ts`:

```typescript
// Remove this section or make it debug-only:
// if (activeTenant?.tenant_id) {
//   res.headers.set('x-tenant-id', activeTenant.tenant_id)
// }

// If needed for debugging, only in development:
if (process.env.NODE_ENV === 'development' && activeTenant?.tenant_id) {
  res.headers.set('x-tenant-id', activeTenant.tenant_id)
}
```

---

## P3: Backlog Improvements

### 13. Secure Cookie Configuration Enhancement

Update `lib/agent/cookies.ts` for production consistency:

```typescript
cookieStore.set({
  name: COOKIE_NAME,
  value,
  httpOnly: true,
  sameSite: 'strict',  // Changed from 'lax' for better security
  secure: process.env.NODE_ENV === 'production',  // Dynamic based on environment
  maxAge: COOKIE_TTL_DAYS * 24 * 60 * 60,
  path: '/'
})
```

---

### 14. Input Sanitization for Error Responses

Create `lib/error-handler.ts`:

```typescript
export function sanitizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // Remove sensitive information from error messages
    const message = error.message
      .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, '[REDACTED]')
      .replace(/sk-[A-Za-z0-9]+/g, '[REDACTED]')
      .replace(/key=[A-Za-z0-9]+/gi, 'key=[REDACTED]')
    
    // In production, return generic message
    if (process.env.NODE_ENV === 'production') {
      return 'An error occurred. Please try again.'
    }
    
    return message
  }
  
  return 'An unknown error occurred'
}
```

---

### 15. Enhanced Validation for Tenant Operations

Add middleware validation for tenant access:

```typescript
// lib/tenant-guard.ts
import { NextRequest, NextResponse } from 'next/server'
import { isMemberOfTenant } from '@/lib/permissions'

export async function validateTenantAccess(
  userId: string,
  tenantId: string,
  requiredRole?: 'MEMBER' | 'TENANT_ADMIN' | 'SUPER_ADMIN'
): Promise<{ valid: boolean; error?: string }> {
  const isMember = await isMemberOfTenant(userId, tenantId)
  
  if (!isMember) {
    return { valid: false, error: 'Not a member of this tenant' }
  }
  
  if (requiredRole) {
    const role = await getUserRole(userId, tenantId)
    const roleHierarchy = { 'MEMBER': 1, 'TENANT_ADMIN': 2, 'SUPER_ADMIN': 3 }
    
    if (!role || roleHierarchy[role] < roleHierarchy[requiredRole]) {
      return { valid: false, error: 'Insufficient permissions' }
    }
  }
  
  return { valid: true }
}
```

---

## Deployment Checklist

### Before Production Deployment:

- [ ] Rate limiting implemented and tested
- [ ] CSP and security headers configured
- [ ] SSRF protection in place
- [ ] Invitation email verification enabled
- [ ] npm audit shows no high/critical vulnerabilities
- [ ] Service role key usage minimized and documented
- [ ] Smoke test endpoint secured
- [ ] CORS configured correctly
- [ ] Audit logging enabled
- [ ] Error messages sanitized

### Environment Variables to Add:

```bash
# .env.example additions
UPSTASH_REDIS_REST_URL=your-upstash-url
UPSTASH_REDIS_REST_TOKEN=your-upstash-token
SMOKE_TEST_SECRET=generate-a-secure-secret
```

### Monitoring Setup:

1. Enable Cloud Run metrics for request rates
2. Set up alerts for:
   - Rate limit exceeded events (>100/hour)
   - 4xx/5xx error rates (>5%)
   - Unusual traffic patterns
3. Enable audit log monitoring for security events

---

## Testing the Fixes

### Rate Limiting Test:
```bash
# Should return 429 after limit exceeded
for i in {1..15}; do
  curl -X POST https://your-app.run.app/api/public/agents/test/chat \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"test"}]}'
  echo "Request $i"
done
```

### CSP Test:
```bash
# Check headers
curl -I https://your-app.run.app | grep -i "content-security-policy"
```

### SSRF Test:
```bash
# Should be blocked
curl -X POST https://your-app.run.app/api/... \
  -d '{"url":"http://169.254.169.254/computeMetadata/v1/"}'
```

---

*Implement these fixes in order of priority. Test thoroughly in a staging environment before deploying to production.*
