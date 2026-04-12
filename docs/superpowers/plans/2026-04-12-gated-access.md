# Gated Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard "access denied" block on non-anonymous agents with a gate that accepts a password or invite code before allowing chat.

**Architecture:** New `inviteCodes` Firestore subcollection per agent, password hash stored on agent doc. A verification API endpoint validates credentials and sets a session-scoped httpOnly cookie. Public pages and chat API check this cookie when `allowAnonymous === false`. Management UI added to the agent setup tab below the existing toggle.

**Tech Stack:** Next.js API routes, Firestore (admin SDK), bcryptjs for password hashing, HMAC (Node crypto) for cookie signing, React (client components for settings UI and gate form).

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `lib/agent/access-gate.ts` | Invite code CRUD, password hashing, cookie signing/verification |
| Create | `app/api/public/agents/[agentId]/verify-access/route.ts` | Verification endpoint (password + invite code) |
| Create | `app/api/agents/[id]/access-password/route.ts` | Set/remove access password (authenticated) |
| Create | `app/api/agents/[id]/invite-codes/route.ts` | List/create invite codes (authenticated) |
| Create | `app/api/agents/[id]/invite-codes/[codeId]/route.ts` | Revoke individual invite code (authenticated) |
| Create | `components/agents/access-gate-form.tsx` | Public-facing gate form (password/code input) |
| Create | `components/agents/invite-code-manager.tsx` | Settings UI for invite code CRUD + password management |
| Modify | `lib/firestore-types.ts` | Add `InviteCodeDocument` type + `inviteCodes` collection helper + `accessPassword` field |
| Modify | `lib/types.ts` | Add `accessPassword` to `VibeAgent` interface |
| Modify | `lib/agents/db.ts` | Map `accessPassword` in `mapAgentDoc` |
| Modify | `app/[tenantSlug]/[agentSlug]/page.tsx` | Replace hard block with `AccessGateForm` component |
| Modify | `app/widget/[agentId]/page.tsx` | Replace 404 with compact gate form |
| Modify | `app/api/public/agents/[agentId]/chat/route.ts` | Check session cookie when `allowAnonymous === false` |
| Modify | `components/agents/agent-setup-tab.tsx` | Add `InviteCodeManager` below anonymous toggle |

---

### Task 1: Types and Firestore Schema

Add the `InviteCodeDocument` type, collection path helper, and `accessPassword` field to the agent types.

**Files:**
- Modify: `lib/firestore-types.ts`
- Modify: `lib/types.ts`
- Modify: `lib/agents/db.ts`

- [ ] **Step 1: Add InviteCodeDocument type to firestore-types.ts**

In `lib/firestore-types.ts`, add above the `Collections` object (around line 828):

```typescript
// ─── Invite codes (gated access) ────────────────────────────────────

export interface InviteCodeRedemption {
  redeemedAt: string
  externalId: string
}

export interface InviteCodeDocument {
  id: string
  code: string
  createdAt: string
  expiresAt: string | null
  maxUses: number | null
  usedCount: number
  revoked: boolean
  redemptions: InviteCodeRedemption[]
}
```

- [ ] **Step 2: Add accessPassword to AgentDocument**

In `lib/firestore-types.ts`, in the `AgentDocument` interface, add after `allowAnonymous: boolean`:

```typescript
  accessPassword?: string | null
```

- [ ] **Step 3: Add inviteCodes collection helper**

In `lib/firestore-types.ts`, in the `Collections` object, add after the `hooks` entry (around line 874):

```typescript
  inviteCodes: (tenantId: string, agentId: string) =>
    `tenants/${tenantId}/agents/${agentId}/invite_codes` as const,
```

- [ ] **Step 4: Add accessPassword to VibeAgent interface**

In `lib/types.ts`, in the `VibeAgent` interface, add after `allowAnonymous: boolean` (line 65):

```typescript
  accessPassword?: string | null
```

- [ ] **Step 5: Map accessPassword in mapAgentDoc**

In `lib/agents/db.ts`, in the `mapAgentDoc` function, add the field mapping:

```typescript
  accessPassword: data.accessPassword ?? null,
```

- [ ] **Step 6: Commit**

```bash
git add lib/firestore-types.ts lib/types.ts lib/agents/db.ts
git commit -m "feat(gated-access): add InviteCodeDocument type and accessPassword field"
```

---

### Task 2: Access Gate Core Library

Create the core library for password hashing, cookie signing/verification, and invite code CRUD operations.

**Files:**
- Create: `lib/agent/access-gate.ts`

- [ ] **Step 1: Create access-gate.ts with password helpers**

Create `lib/agent/access-gate.ts`:

```typescript
import { createHmac, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { adminDb } from '@/lib/firebase/admin'
import { Collections, type InviteCodeDocument } from '@/lib/firestore-types'
import { FieldValue } from 'firebase-admin/firestore'

// ─── Password hashing (simple HMAC — no need for bcrypt in server-only code) ─

const SECRET = process.env.ACCESS_GATE_SECRET || 'vibeagent-access-gate-default'

export function hashPassword(plaintext: string): string {
  return createHmac('sha256', SECRET).update(plaintext).digest('hex')
}

export function verifyPassword(plaintext: string, hash: string): boolean {
  return hashPassword(plaintext) === hash
}

// ─── Session cookie ─────────────────────────────────────────────────

function signToken(agentId: string): string {
  const payload = JSON.stringify({ agentId, ts: Date.now() })
  const sig = createHmac('sha256', SECRET).update(payload).digest('hex')
  return Buffer.from(payload).toString('base64') + '.' + sig
}

function verifyToken(token: string, agentId: string): boolean {
  const [b64, sig] = token.split('.')
  if (!b64 || !sig) return false
  try {
    const payload = Buffer.from(b64, 'base64').toString()
    const expected = createHmac('sha256', SECRET).update(payload).digest('hex')
    if (sig !== expected) return false
    const data = JSON.parse(payload)
    return data.agentId === agentId
  } catch {
    return false
  }
}

function cookieName(agentId: string) {
  return `va_access_${agentId}`
}

export async function setAccessCookie(agentId: string, opts?: { crossOrigin?: boolean }) {
  const cookieStore = await cookies()
  cookieStore.set({
    name: cookieName(agentId),
    value: signToken(agentId),
    httpOnly: true,
    secure: true,
    sameSite: opts?.crossOrigin ? 'none' : 'lax',
    path: '/'
    // No maxAge = session cookie — dies on browser close
  })
}

export async function hasValidAccessCookie(agentId: string): Promise<boolean> {
  const cookieStore = await cookies()
  const token = cookieStore.get(cookieName(agentId))?.value
  if (!token) return false
  return verifyToken(token, agentId)
}

// ─── Invite code CRUD ───────────────────────────────────────────────

function codesCollection(tenantId: string, agentId: string) {
  return adminDb.collection(Collections.inviteCodes(tenantId, agentId))
}

export async function createInviteCode(
  tenantId: string,
  agentId: string,
  opts: { code?: string; expiresAt?: string | null; maxUses?: number | null }
): Promise<InviteCodeDocument> {
  const code = (opts.code || generateCode()).toUpperCase()
  const ref = codesCollection(tenantId, agentId).doc()
  const doc: InviteCodeDocument = {
    id: ref.id,
    code,
    createdAt: new Date().toISOString(),
    expiresAt: opts.expiresAt ?? null,
    maxUses: opts.maxUses ?? null,
    usedCount: 0,
    revoked: false,
    redemptions: []
  }
  await ref.set(doc)
  return doc
}

export async function listInviteCodes(
  tenantId: string,
  agentId: string
): Promise<InviteCodeDocument[]> {
  const snap = await codesCollection(tenantId, agentId)
    .orderBy('createdAt', 'desc')
    .get()
  return snap.docs.map(d => d.data() as InviteCodeDocument)
}

export async function revokeInviteCode(
  tenantId: string,
  agentId: string,
  codeId: string
): Promise<void> {
  await codesCollection(tenantId, agentId).doc(codeId).update({ revoked: true })
}

export type InviteCodeError = 'invalid' | 'revoked' | 'expired' | 'max_uses_reached'

export async function redeemInviteCode(
  tenantId: string,
  agentId: string,
  codeValue: string,
  externalId: string
): Promise<{ ok: true } | { ok: false; reason: InviteCodeError }> {
  const snap = await codesCollection(tenantId, agentId)
    .where('code', '==', codeValue.toUpperCase())
    .limit(1)
    .get()

  if (snap.empty) return { ok: false, reason: 'invalid' }

  const docRef = snap.docs[0].ref
  const data = snap.docs[0].data() as InviteCodeDocument

  if (data.revoked) return { ok: false, reason: 'revoked' }
  if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
    return { ok: false, reason: 'expired' }
  }
  if (data.maxUses !== null && data.usedCount >= data.maxUses) {
    return { ok: false, reason: 'max_uses_reached' }
  }

  // Atomic update via transaction
  await adminDb.runTransaction(async tx => {
    const fresh = await tx.get(docRef)
    const freshData = fresh.data() as InviteCodeDocument
    if (freshData.maxUses !== null && freshData.usedCount >= freshData.maxUses) {
      throw new Error('max_uses_reached')
    }
    tx.update(docRef, {
      usedCount: FieldValue.increment(1),
      redemptions: FieldValue.arrayUnion({
        redeemedAt: new Date().toISOString(),
        externalId
      })
    })
  })

  return { ok: true }
}

// ─── Helpers ────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I/O/0/1 for readability
  const bytes = randomBytes(6)
  let result = 'VIBE-'
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/access-gate.ts
git commit -m "feat(gated-access): add access-gate core library with password, cookie, and invite code helpers"
```

---

### Task 3: Verification API Endpoint

Create the public endpoint that validates a password or invite code and sets the session cookie.

**Files:**
- Create: `app/api/public/agents/[agentId]/verify-access/route.ts`

- [ ] **Step 1: Create verify-access route**

Create `app/api/public/agents/[agentId]/verify-access/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { getAgentById } from '@/lib/agents/server'
import { ensureExternalSessionId } from '@/lib/agent/cookies'
import {
  verifyPassword,
  setAccessCookie,
  redeemInviteCode
} from '@/lib/agent/access-gate'

export const runtime = 'nodejs'

const verifyAccessSchema = z.object({
  type: z.enum(['password', 'invite_code']),
  value: z.string().min(1).max(200)
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  // Only relevant when anonymous is off
  if (agent.allowAnonymous) {
    return NextResponse.json({ error: 'Agent allows anonymous access' }, { status: 400 })
  }

  const body = await req.json()
  const parsed = verifyAccessSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { type, value } = parsed.data
  const isEmbed = req.headers.get('x-embed') === 'true'

  if (type === 'password') {
    if (!agent.accessPassword) {
      return NextResponse.json({ error: 'Password not configured' }, { status: 403 })
    }
    if (!verifyPassword(value, agent.accessPassword)) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 403 })
    }
    await setAccessCookie(agentId, { crossOrigin: isEmbed })
    return NextResponse.json({ ok: true })
  }

  // type === 'invite_code'
  const externalId = await ensureExternalSessionId({ crossOrigin: isEmbed })
  const result = await redeemInviteCode(agent.tenantId!, agentId, value, externalId)

  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid: 'Invalid code',
      revoked: 'This code has been revoked',
      expired: 'This code has expired',
      max_uses_reached: 'This code has reached its usage limit'
    }
    return NextResponse.json(
      { error: messages[result.reason], code: result.reason },
      { status: 403 }
    )
  }

  await setAccessCookie(agentId, { crossOrigin: isEmbed })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/public/agents/[agentId]/verify-access/route.ts
git commit -m "feat(gated-access): add verify-access API endpoint"
```

---

### Task 4: Chat API — Accept Session Cookie

Modify the public chat API to accept the access session cookie when `allowAnonymous` is false.

**Files:**
- Modify: `app/api/public/agents/[agentId]/chat/route.ts`

- [ ] **Step 1: Add cookie check to chat route**

In `app/api/public/agents/[agentId]/chat/route.ts`, add import at top:

```typescript
import { hasValidAccessCookie } from '@/lib/agent/access-gate'
```

Then replace the block at lines 47-51:

```typescript
  if (!agent.allowAnonymous) {
    return new NextResponse('Agent does not allow anonymous chat', {
      status: 403
    })
  }
```

With:

```typescript
  if (!agent.allowAnonymous) {
    const hasAccess = await hasValidAccessCookie(agentId)
    if (!hasAccess) {
      return new NextResponse('Agent does not allow anonymous chat', {
        status: 403
      })
    }
  }
```

- [ ] **Step 2: Do the same for handoff target validation**

Find the handoff target check (around line 111-116) that checks `targetAgent.allowAnonymous` and apply the same pattern:

```typescript
  if (!targetAgent.allowAnonymous) {
    const hasAccess = await hasValidAccessCookie(targetAgent.id)
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Target agent does not allow anonymous chat' },
        { status: 403 }
      )
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add app/api/public/agents/[agentId]/chat/route.ts
git commit -m "feat(gated-access): check access cookie in public chat API"
```

---

### Task 5: Access Gate Form Component

Create the client-side gate form that appears on the public agent page when anonymous is off.

**Files:**
- Create: `components/agents/access-gate-form.tsx`

- [ ] **Step 1: Create AccessGateForm component**

Create `components/agents/access-gate-form.tsx`:

```typescript
'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

interface AccessGateFormProps {
  agentId: string
  agentName: string
  logoUrl?: string | null
  embed?: boolean
  onVerified: () => void
}

export function AccessGateForm({
  agentId,
  agentName,
  logoUrl,
  embed,
  onVerified
}: AccessGateFormProps) {
  const searchParams = useSearchParams()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Auto-validate URL code on mount
  useEffect(() => {
    const code = searchParams.get('code')
    if (code) {
      verify('invite_code', code)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function verify(type: 'password' | 'invite_code', val: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/public/agents/${agentId}/verify-access`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(embed ? { 'x-embed': 'true' } : {})
        },
        body: JSON.stringify({ type, value: val })
      })
      if (res.ok) {
        onVerified()
        return
      }
      const data = await res.json()
      setError(data.error || 'Access denied')
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    // Try password first — API handles the logic
    // If it looks like an invite code (has VIBE- prefix or is uppercase alphanumeric), try code
    const looksLikeCode = /^VIBE-/i.test(trimmed) || /^[A-Z0-9-]{4,}$/i.test(trimmed)
    verify(looksLikeCode ? 'invite_code' : 'password', trimmed)
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="mx-auto w-full max-w-md rounded-2xl border border-[#e4e3e3] bg-[#f5f8f7] p-8 text-center shadow-[0_4px_24px_rgba(0,0,0,0.08)] dark:border-[#344348] dark:bg-[#192425]">
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            className="mx-auto mb-4 h-12 w-12 rounded-full object-cover"
          />
        )}
        <h1 className="font-sans text-2xl font-normal text-[#222f30] dark:text-[#f5f8f7]">
          {agentName}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[#445e5f] dark:text-[#6f7f80]">
          Enter a password or invite code to continue.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3">
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Password or invite code"
            disabled={loading}
            autoFocus
            className="w-full rounded-lg border border-[#e4e3e3] bg-white px-4 py-3 text-sm text-[#222f30] placeholder-[#9d9790] outline-none transition-shadow focus:border-[#D97757] focus:ring-2 focus:ring-[#D97757]/20 disabled:opacity-50 dark:border-[#344348] dark:bg-[#1a2526] dark:text-[#f5f8f7] dark:placeholder-[#6f7f80]"
          />
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="w-full rounded-lg bg-[#D97757] px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#CC785C] disabled:opacity-50"
          >
            {loading ? 'Verifying...' : 'Continue'}
          </button>
        </form>

        {error && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/agents/access-gate-form.tsx
git commit -m "feat(gated-access): add AccessGateForm client component"
```

---

### Task 6: Public Agent Page — Use Gate Form

Replace the hard "access denied" block on the public agent page with the gate form + verified state.

**Files:**
- Modify: `app/[tenantSlug]/[agentSlug]/page.tsx`

- [ ] **Step 1: Create a client wrapper for the gated flow**

The public page is a Server Component, but the gate requires client-side state (verified/not). Create a thin client wrapper. Add a new file `app/[tenantSlug]/[agentSlug]/gated-agent-page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { AccessGateForm } from '@/components/agents/access-gate-form'
import type { VibeAgent } from '@/lib/types'

interface GatedAgentPageProps {
  agent: VibeAgent
  googleReviewPlaceId: string | null
  logoUrl: string | null
  hasExistingAccess: boolean
}

export function GatedAgentPage({
  agent,
  googleReviewPlaceId,
  logoUrl,
  hasExistingAccess
}: GatedAgentPageProps) {
  const [verified, setVerified] = useState(hasExistingAccess)

  if (verified) {
    return (
      <PublicAgentExperience
        agent={agent}
        googleReviewPlaceId={googleReviewPlaceId}
        logoUrl={logoUrl}
      />
    )
  }

  return (
    <AccessGateForm
      agentId={agent.id}
      agentName={agent.name}
      logoUrl={logoUrl}
      onVerified={() => setVerified(true)}
    />
  )
}
```

- [ ] **Step 2: Update the public agent page server component**

In `app/[tenantSlug]/[agentSlug]/page.tsx`, add imports:

```typescript
import { hasValidAccessCookie } from '@/lib/agent/access-gate'
import { GatedAgentPage } from './gated-agent-page'
```

Replace the return block (lines 67-90) with:

```typescript
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#f7f7f5] dark:bg-[#222f30]">
      {agent.allowAnonymous ? (
        <PublicAgentExperience
          agent={agent}
          googleReviewPlaceId={googleReviewPlaceId}
          logoUrl={logoUrl}
        />
      ) : (
        <GatedAgentPage
          agent={agent}
          googleReviewPlaceId={googleReviewPlaceId}
          logoUrl={logoUrl}
          hasExistingAccess={await hasValidAccessCookie(agent.id)}
        />
      )}
    </div>
  )
```

- [ ] **Step 3: Commit**

```bash
git add app/[tenantSlug]/[agentSlug]/gated-agent-page.tsx app/[tenantSlug]/[agentSlug]/page.tsx
git commit -m "feat(gated-access): replace hard block with gate form on public agent page"
```

---

### Task 7: Widget Page — Use Gate Form

Replace the 404 on the widget embed page with a compact gate form.

**Files:**
- Modify: `app/widget/[agentId]/page.tsx`

- [ ] **Step 1: Create a gated widget wrapper**

Create `app/widget/[agentId]/gated-widget-page.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { AccessGateForm } from '@/components/agents/access-gate-form'
import type { VibeAgent } from '@/lib/types'

interface GatedWidgetPageProps {
  agent: VibeAgent
  hasExistingAccess: boolean
}

export function GatedWidgetPage({ agent, hasExistingAccess }: GatedWidgetPageProps) {
  const [verified, setVerified] = useState(hasExistingAccess)

  if (verified) {
    return <PublicAgentExperience agent={agent} embed />
  }

  return (
    <AccessGateForm
      agentId={agent.id}
      agentName={agent.name}
      embed
      onVerified={() => setVerified(true)}
    />
  )
}
```

- [ ] **Step 2: Update widget page**

Replace `app/widget/[agentId]/page.tsx` entirely:

```typescript
import { notFound } from 'next/navigation'

import { getAgentById } from '@/lib/agents/server'
import { PublicAgentExperience } from '@/components/agents/public-agent-experience'
import { hasValidAccessCookie } from '@/lib/agent/access-gate'
import { GatedWidgetPage } from './gated-widget-page'

export const runtime = 'nodejs'

export default async function WidgetPage({
  params
}: {
  params: Promise<{ agentId: string }>
}) {
  const { agentId } = await params
  const agent = await getAgentById(agentId)

  if (!agent) {
    notFound()
  }

  if (agent.allowAnonymous) {
    return <PublicAgentExperience agent={agent} embed />
  }

  return (
    <GatedWidgetPage
      agent={agent}
      hasExistingAccess={await hasValidAccessCookie(agentId)}
    />
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add app/widget/[agentId]/gated-widget-page.tsx app/widget/[agentId]/page.tsx
git commit -m "feat(gated-access): replace 404 with gate form on widget embed"
```

---

### Task 8: Authenticated API — Password Management

Create the API endpoint for agent owners to set/remove the access password.

**Files:**
- Create: `app/api/agents/[id]/access-password/route.ts`

- [ ] **Step 1: Create access-password route**

Create `app/api/agents/[id]/access-password/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { adminDb } from '@/lib/firebase/admin'
import { Collections } from '@/lib/firestore-types'
import { requireAuth } from '@/lib/auth'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import { hashPassword } from '@/lib/agent/access-gate'

export const runtime = 'nodejs'

const setPasswordSchema = z.object({
  password: z.string().min(1).max(200)
})

// PUT — set password
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  const body = await req.json()
  const parsed = setPasswordSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  await adminDb
    .collection(Collections.agents(agent.tenantId!))
    .doc(id)
    .update({ accessPassword: hashPassword(parsed.data.password) })

  return NextResponse.json({ ok: true })
}

// DELETE — remove password
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  await adminDb
    .collection(Collections.agents(agent.tenantId!))
    .doc(id)
    .update({ accessPassword: null })

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/agents/[id]/access-password/route.ts
git commit -m "feat(gated-access): add access-password management API"
```

---

### Task 9: Authenticated API — Invite Code CRUD

Create API endpoints for listing, creating, and revoking invite codes.

**Files:**
- Create: `app/api/agents/[id]/invite-codes/route.ts`
- Create: `app/api/agents/[id]/invite-codes/[codeId]/route.ts`

- [ ] **Step 1: Create invite-codes list/create route**

Create `app/api/agents/[id]/invite-codes/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import { createInviteCode, listInviteCodes } from '@/lib/agent/access-gate'

export const runtime = 'nodejs'

const createCodeSchema = z.object({
  code: z.string().min(3).max(50).optional(),
  expiresAt: z.string().nullable().optional(),
  maxUses: z.number().int().min(1).nullable().optional()
})

// GET — list invite codes
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  const codes = await listInviteCodes(agent.tenantId!, id)
  return NextResponse.json(codes)
}

// POST — create invite code
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  const body = await req.json()
  const parsed = createCodeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const code = await createInviteCode(agent.tenantId!, id, parsed.data)
  return NextResponse.json(code, { status: 201 })
}
```

- [ ] **Step 2: Create invite-codes revoke route**

Create `app/api/agents/[id]/invite-codes/[codeId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { getAgentById } from '@/lib/agents/server'
import { canEditAgent } from '@/lib/agents/permissions'
import { revokeInviteCode } from '@/lib/agent/access-gate'

export const runtime = 'nodejs'

// PATCH — revoke invite code
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; codeId: string }> }
) {
  const { id, codeId } = await params
  const authResult = await requireAuth()
  if (!authResult.ok) return authResult.response

  const agent = await getAgentById(id)
  if (!agent) return new NextResponse('Not found', { status: 404 })

  const allowed = await canEditAgent({
    sessionUserId: authResult.user.id,
    agentOwnerId: agent.userId,
    tenantId: agent.tenantId!
  })
  if (!allowed) return new NextResponse('Forbidden', { status: 403 })

  await revokeInviteCode(agent.tenantId!, id, codeId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/agents/[id]/invite-codes/route.ts app/api/agents/[id]/invite-codes/[codeId]/route.ts
git commit -m "feat(gated-access): add invite code CRUD API endpoints"
```

---

### Task 10: Invite Code Manager UI Component

Create the settings UI component for managing passwords and invite codes.

**Files:**
- Create: `components/agents/invite-code-manager.tsx`

- [ ] **Step 1: Create InviteCodeManager component**

Create `components/agents/invite-code-manager.tsx`. This is a large client component with:

1. **Password section**: input to set/remove access password, calls `PUT /api/agents/{id}/access-password` or `DELETE`.
2. **Invite codes section**: form to generate codes (optional custom code, expiry date, max uses), table listing existing codes with status/uses/actions, expandable redemption log per row.
3. **State**: fetches codes on mount via `GET /api/agents/{id}/invite-codes`, refetches after create/revoke.
4. **Row actions**: copy code button, copy invite link button (`/{tenantSlug}/{agentUrl}?code=XXX`), revoke button.
5. **Status display**: derives status from code data — "active", "expired" (expiresAt < now), "revoked" (revoked === true), "exhausted" (usedCount >= maxUses).

```typescript
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Copy, Trash2, Plus, Eye, EyeOff, ChevronDown, ChevronUp, Link } from 'lucide-react'
import type { InviteCodeDocument } from '@/lib/firestore-types'

interface InviteCodeManagerProps {
  agentId: string
  tenantSlug: string
  agentUrl: string
  hasPassword: boolean
  disabled?: boolean
}

function codeStatus(code: InviteCodeDocument): 'active' | 'expired' | 'revoked' | 'exhausted' {
  if (code.revoked) return 'revoked'
  if (code.expiresAt && new Date(code.expiresAt) < new Date()) return 'expired'
  if (code.maxUses !== null && code.usedCount >= code.maxUses) return 'exhausted'
  return 'active'
}

const statusColors: Record<string, string> = {
  active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  expired: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  revoked: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  exhausted: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400'
}

export function InviteCodeManager({
  agentId,
  tenantSlug,
  agentUrl,
  hasPassword: initialHasPassword,
  disabled
}: InviteCodeManagerProps) {
  // ─── Password state ───
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [hasPassword, setHasPassword] = useState(initialHasPassword)
  const [savingPassword, setSavingPassword] = useState(false)

  // ─── Invite code state ───
  const [codes, setCodes] = useState<InviteCodeDocument[]>([])
  const [loadingCodes, setLoadingCodes] = useState(true)
  const [customCode, setCustomCode] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [maxUses, setMaxUses] = useState('')
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const fetchCodes = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/invite-codes`)
      if (res.ok) setCodes(await res.json())
    } finally {
      setLoadingCodes(false)
    }
  }, [agentId])

  useEffect(() => { fetchCodes() }, [fetchCodes])

  // ─── Password handlers ───
  async function savePassword() {
    setSavingPassword(true)
    try {
      await fetch(`/api/agents/${agentId}/access-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      setHasPassword(true)
      setPassword('')
    } finally {
      setSavingPassword(false)
    }
  }

  async function removePassword() {
    setSavingPassword(true)
    try {
      await fetch(`/api/agents/${agentId}/access-password`, { method: 'DELETE' })
      setHasPassword(false)
    } finally {
      setSavingPassword(false)
    }
  }

  // ─── Invite code handlers ───
  async function generateCode() {
    setCreating(true)
    try {
      const res = await fetch(`/api/agents/${agentId}/invite-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: customCode || undefined,
          expiresAt: expiresAt || null,
          maxUses: maxUses ? parseInt(maxUses, 10) : null
        })
      })
      if (res.ok) {
        setCustomCode('')
        setExpiresAt('')
        setMaxUses('')
        fetchCodes()
      }
    } finally {
      setCreating(false)
    }
  }

  async function revoke(codeId: string) {
    await fetch(`/api/agents/${agentId}/invite-codes/${codeId}`, { method: 'PATCH' })
    fetchCodes()
  }

  function copyText(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  function inviteLink(code: string) {
    return `${window.location.origin}/${tenantSlug}/${agentUrl}?code=${code}`
  }

  return (
    <div className="space-y-4">
      {/* Password section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Access Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Anyone with this password can access the agent.
          </p>
          {hasPassword ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">Password set</Badge>
              <Button
                size="sm"
                variant="ghost"
                onClick={removePassword}
                disabled={disabled || savingPassword}
                className="text-red-600 hover:text-red-700"
              >
                <Trash2 className="mr-1 h-3 w-3" /> Remove
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Set a password"
                  disabled={disabled || savingPassword}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                size="sm"
                onClick={savePassword}
                disabled={disabled || savingPassword || !password.trim()}
              >
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite codes section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Invite Codes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Generate form */}
          <div className="space-y-2 rounded-md border p-3">
            <div className="flex gap-2">
              <Input
                value={customCode}
                onChange={e => setCustomCode(e.target.value)}
                placeholder="Custom code (optional)"
                disabled={disabled || creating}
                className="flex-1"
              />
              <Button
                size="sm"
                onClick={generateCode}
                disabled={disabled || creating}
              >
                <Plus className="mr-1 h-3 w-3" /> Generate
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Expires</label>
                <Input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={e => setExpiresAt(e.target.value)}
                  disabled={disabled || creating}
                  className="mt-1"
                />
              </div>
              <div className="w-24">
                <label className="text-xs text-muted-foreground">Max uses</label>
                <Input
                  type="number"
                  min={1}
                  value={maxUses}
                  onChange={e => setMaxUses(e.target.value)}
                  placeholder="∞"
                  disabled={disabled || creating}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Code list */}
          {loadingCodes ? (
            <p className="text-xs text-muted-foreground">Loading...</p>
          ) : codes.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No invite codes yet. Generate one to share gated access.
            </p>
          ) : (
            <div className="space-y-2">
              {codes.map(code => {
                const status = codeStatus(code)
                const isExpanded = expandedId === code.id
                return (
                  <div
                    key={code.id}
                    className="rounded-md border p-3"
                  >
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">{code.code}</code>
                      <Badge className={`text-xs ${statusColors[status]}`}>{status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {code.usedCount}{code.maxUses !== null ? `/${code.maxUses}` : ''} uses
                      </span>
                      <span className="flex-1" />
                      <button
                        onClick={() => copyText(code.code, `code-${code.id}`)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy code"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => copyText(inviteLink(code.code), `link-${code.id}`)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Copy invite link"
                      >
                        <Link className="h-3.5 w-3.5" />
                      </button>
                      {status === 'active' && (
                        <button
                          onClick={() => revoke(code.id)}
                          className="text-red-500 hover:text-red-700"
                          title="Revoke"
                          disabled={disabled}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {code.redemptions.length > 0 && (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : code.id)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                    {copied === `code-${code.id}` && <span className="text-xs text-green-600">Copied!</span>}
                    {copied === `link-${code.id}` && <span className="text-xs text-green-600">Link copied!</span>}
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      {code.expiresAt && (
                        <span>Expires: {new Date(code.expiresAt).toLocaleDateString()}</span>
                      )}
                      <span>Created: {new Date(code.createdAt).toLocaleDateString()}</span>
                    </div>
                    {isExpanded && code.redemptions.length > 0 && (
                      <div className="mt-2 border-t pt-2">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">Redemptions</p>
                        {code.redemptions.map((r, i) => (
                          <div key={i} className="flex justify-between text-xs text-muted-foreground">
                            <span className="font-mono">{r.externalId.slice(0, 8)}...</span>
                            <span>{new Date(r.redeemedAt).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/agents/invite-code-manager.tsx
git commit -m "feat(gated-access): add InviteCodeManager settings component"
```

---

### Task 11: Integrate InviteCodeManager into Agent Setup Tab

Wire the invite code manager into the existing agent setup tab, showing it below the anonymous toggle when the toggle is off.

**Files:**
- Modify: `components/agents/agent-setup-tab.tsx`

- [ ] **Step 1: Add props and import**

In `components/agents/agent-setup-tab.tsx`, add import:

```typescript
import { InviteCodeManager } from './invite-code-manager'
```

Add new props to `AgentSetupTabProps` interface (after `canEdit: boolean`):

```typescript
  agentId: string
  hasAccessPassword: boolean
```

Add the new props to the destructured params in the function signature.

- [ ] **Step 2: Add InviteCodeManager below the toggle**

After the `</div>` that closes the anonymous toggle block (line 105), add:

```typescript
          {!allowAnonymous && (
            <div className="mt-3">
              <InviteCodeManager
                agentId={agentId}
                tenantSlug={tenantSlug ?? ''}
                agentUrl={agentUrl}
                hasPassword={hasAccessPassword}
                disabled={saving || !canEdit}
              />
            </div>
          )}
```

- [ ] **Step 3: Update parent component(s) that render AgentSetupTab**

Find components that render `<AgentSetupTab>` and pass the new `agentId` and `hasAccessPassword` props. The parent likely already has the agent object, so:

```typescript
<AgentSetupTab
  // ... existing props
  agentId={agent.id}
  hasAccessPassword={!!agent.accessPassword}
/>
```

Search for all usages with: `grep -rn "AgentSetupTab" components/ app/` and update each one.

- [ ] **Step 4: Commit**

```bash
git add components/agents/agent-setup-tab.tsx
# Also add any parent component files that were modified
git commit -m "feat(gated-access): integrate InviteCodeManager into agent setup tab"
```

---

### Task 12: Verify Build and Manual Test

Ensure the full feature compiles and the basic flow works.

**Files:**
- None (verification only)

- [ ] **Step 1: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 2: Run Next.js build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Manual smoke test checklist**

1. Create an agent, turn off "Allow anonymous chat"
2. Verify InviteCodeManager appears below the toggle
3. Set a password, verify "Password set" badge appears
4. Generate an invite code, verify it appears in the list
5. Visit the agent's public URL — verify gate form appears
6. Enter the password — verify chat loads
7. Close browser, reopen URL — verify gate reappears (session cookie gone)
8. Use `?code=VIBE-XXXX` in URL — verify auto-validation
9. Revoke a code, try using it — verify "This code has been revoked" error
10. Test widget embed — verify gate form appears instead of 404

- [ ] **Step 4: Commit any fixes from smoke testing**

```bash
git add -A
git commit -m "fix(gated-access): address issues found during smoke testing"
```
