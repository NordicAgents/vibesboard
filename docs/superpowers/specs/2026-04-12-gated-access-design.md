# Gated Access for Non-Anonymous Agents

**Date:** 2026-04-12
**Status:** Approved

## Problem

When "Allow anonymous chat" is turned off on an agent, visitors who scan a QR code or visit the agent link see a hard "access denied" message with no way in. This fully blocks public access instead of gating it.

## Solution

Replace the hard block with a gate that accepts a **password** or **invite code** before allowing the chat. Agent owners manage both from the existing setup tab.

---

## Data Model

### Agent Document — New Fields

```typescript
accessPassword?: string | null   // bcrypt-hashed password, null = no password set
```

### Subcollection: `agents/{agentId}/inviteCodes/{codeId}`

```typescript
interface InviteCodeDocument {
  id: string
  code: string              // the actual code string (e.g., "VIBE-A3X9K2")
  createdAt: string         // ISO timestamp
  expiresAt?: string | null // ISO timestamp, null = never expires
  maxUses?: number | null   // null = unlimited
  usedCount: number         // incremented on each redemption
  revoked: boolean          // owner can flip this to kill a code
  redemptions: Array<{      // log of each use
    redeemedAt: string      // ISO timestamp
    externalId: string      // ties to the va_ext session cookie
  }>
}
```

- `redemptions` array is naturally bounded by `maxUses`.
- `code` field is indexed for lookups during validation.
- Password is hashed server-side with bcrypt — never stored or compared in plaintext.

---

## Verification API

### Endpoint: `POST /api/public/agents/[agentId]/verify-access`

**Request body:**

```typescript
{
  type: 'password' | 'invite_code'
  value: string   // the password or invite code
}
```

### Validation Logic

**Password:**
1. Fetch agent document.
2. Compare `value` against `accessPassword` using bcrypt.
3. On match: set session cookie, return 200.

**Invite code:**
1. Query `inviteCodes` subcollection where `code == value` (case-insensitive, stored uppercase).
2. Check: exists? not revoked? not expired? `usedCount < maxUses`?
3. On valid: atomically increment `usedCount`, push to `redemptions` array, set session cookie, return 200.
4. On invalid: return 403 with reason (`"expired"`, `"revoked"`, `"max_uses_reached"`, `"invalid"`).

### Session Cookie

- **Name:** `va_access_{agentId}` (scoped per agent)
- **Value:** HMAC-signed token containing `{ agentId, verifiedAt }`
- **Flags:** `httpOnly: true`, `secure: true`, `sameSite: 'lax'`
- **No `max-age` or `expires`** — session cookie, dies on browser close
- For widget embeds: `sameSite: 'none'` (matching existing `va_ext` cross-origin behavior)

### Chat API Change

In `/api/public/agents/[agentId]/chat`, when `allowAnonymous === false`:
1. Check for `va_access_{agentId}` cookie.
2. Verify HMAC signature.
3. If valid: allow chat.
4. If missing/invalid: return 403.

---

## Public Page Gate UI

### Auto-validation (URL code)

If URL has `?code=ABC123`, call verify-access API automatically on page load. On success: show chat. On failure: show gate form with error message.

### Gate Form

Renders when `allowAnonymous === false` and no valid session cookie exists.

- Centered card, warm styling matching the existing design system.
- Agent name + logo at top.
- Single text input: "Enter password or invite code".
- Submit button.
- Error message area (e.g., "Invalid code", "Code expired", "Code has reached its usage limit").
- **No separate fields** for password vs code — one input, the API determines which: tries password first, then code lookup.

### On Successful Verification

Gate disappears, `PublicAgentExperience` renders (same as anonymous-enabled flow). If browser tab is closed and reopened, session cookie is gone and gate reappears.

### Widget Embed

Currently returns 404 when anonymous is off. New behavior: show a compact version of the gate form inside the widget. Same verification flow, smaller layout.

---

## Agent Settings UI

**Location:** Agent setup tab, directly below the "Allow anonymous chat" toggle. Only visible when toggle is OFF.

### Password Section

- "Access Password" label.
- Password input with show/hide toggle.
- Save button.
- "Remove password" button if one is set.
- Helper text: "Anyone with this password can access the agent."

### Invite Codes Section

**Generate code form:**
- Auto-generated code (e.g., `VIBE-A3X9K2`) with option to set a custom one.
- Optional expiry date picker.
- Optional max uses number input.
- "Generate" button.

**Code list table:**
- Columns: Code, Status (active / expired / revoked / exhausted), Uses (e.g., "3/10"), Expires, Created.
- Row actions: Copy code, Copy invite link, Revoke.
- Expandable row: shows redemption log (timestamp + externalId).

**Invite link format:** `/{tenantSlug}/{agentSlug}?code=VIBE-A3X9K2`

**Code generation:** Client-side random string — `VIBE-` prefix + 6 uppercase alphanumeric characters. Uniqueness checked on write.

**Empty state:** "No invite codes yet. Generate one to share gated access."

---

## Error Handling & Edge Cases

### Race Conditions
Redemption uses a Firestore transaction: read `usedCount`, check < `maxUses`, increment + push to `redemptions` atomically. Prevents over-redemption under concurrent access.

### Mid-Conversation Revocation
If a code is revoked while someone is mid-chat, their session cookie remains valid for that browser session. They lose access only when the session ends (browser close). No mid-chat interruption.

### Password Change
Changing the password does not invalidate existing session cookies. Current sessions continue until browser close. New visitors must use the new password.

### Agent with Both Password AND Codes
Both are valid entry methods. The single input tries password match first, then code lookup. If no password is set, only code lookup runs.

### Code Format
Case-insensitive matching (stored uppercase, input uppercased before comparison). 6 alphanumeric chars after `VIBE-` prefix provides ~2 billion combinations.
