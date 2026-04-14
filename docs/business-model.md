# VibeAgent Business Model

## Overview

VibeAgent follows a **subscription + usage hybrid model**. Each plan includes a monthly message allowance. All plans include unlimited agents — agents are configuration, not a cost driver. The cost driver is **messages** (LLM calls), which are metered regardless of source.

---

## Subscription Tiers

| Tier | Price | Seats | Messages Included | Overage Rate |
|---|---|---|---|---|
| **Free** | $0/mo | 1 | 100/mo | Hard cap (no overage) |
| **Pro** | $19/mo | 1 | 5,000/mo | $0.005/message |
| **Team** | $10/seat/mo (min 3 seats) | 3+ | 10,000/seat/mo | $0.003/message |
| **Enterprise** | Custom | Custom | Custom | Custom |

### Unlimited Agents on All Plans

Agents are Firestore configuration documents — they cost nothing until used. Limiting agent count would add artificial friction without protecting margins. The meter is messages, which directly correlates with LLM spend.

---

## Tier Details

### Free

- **Target:** Individual users evaluating the platform
- **Seats:** 1
- **Messages:** 100/month (hard cap, no overage)
- **Features:**
  - Unlimited agents
  - Direct retrieval strategy
  - Basic chat interface
  - Agent links
- **Feature Flags (Basic):**
  - `AGENT_LINKS` — enabled
  - All other flags — disabled
- **Limits:**
  - No embed widget
  - No inbox channels (WhatsApp, Instagram)
  - No notifications
  - No team collaboration
  - No custom branding

### Pro

- **Target:** Individual creators, freelancers, small businesses
- **Seats:** 1
- **Messages:** 5,000/month included, then $0.005/message overage
- **Features:**
  - Everything in Free
  - RAG retrieval strategy
  - Embed widget
  - Agent notifications (in-app, email, webhook)
  - Google Review integration
  - Inbox (base)
- **Feature Flags (Basic + Pro):**
  - `AGENT_LINKS` — enabled
  - `EMBED_WIDGET` — enabled
  - `AGENT_NOTIFICATIONS` — enabled
    - `AGENT_NOTIFICATIONS_INAPP` — enabled
    - `AGENT_NOTIFICATIONS_EMAIL` — enabled
    - `AGENT_NOTIFICATIONS_WEBHOOK` — enabled
  - `GOOGLE_REVIEW` — enabled
  - `INBOX` — enabled
- **Limits:**
  - No WhatsApp/Instagram channels
  - No team collaboration
  - No custom branding

### Team

- **Target:** Teams building and managing agents collaboratively
- **Seats:** Minimum 3, $10/seat/month
- **Messages:** 10,000/seat/month included (e.g., 5 seats = 50K messages), then $0.003/message overage
- **Features:**
  - Everything in Pro
  - Team collaboration with role-based access
  - WhatsApp Inbox
  - Instagram Inbox
  - Chatwoot integration
  - Custom branding
- **Feature Flags (All):**
  - All Pro flags — enabled
  - `TEAM_COLLABORATION` — enabled
  - `WHATSAPP_INBOX` — enabled
  - `INSTAGRAM_INBOX` — enabled
  - `CHATWOOT` — enabled
  - `CUSTOM_BRANDING` — enabled
- **Roles:**
  - `TENANT_ADMIN` — manage agents, team, settings, billing
  - `MEMBER` — create/edit agents, chat

### Enterprise

- **Target:** Large organizations with custom requirements
- **Pricing:** Custom, negotiated
- **Features:**
  - Everything in Team
  - SSO / SAML
  - SLA with guaranteed uptime
  - Dedicated support
  - Custom message limits and overage rates
  - Priority model access

---

## Feature Flag → Plan Mapping

| Feature Flag | Free | Pro | Team | Enterprise |
|---|---|---|---|---|
| `AGENT_LINKS` | Yes | Yes | Yes | Yes |
| `EMBED_WIDGET` | - | Yes | Yes | Yes |
| `GOOGLE_REVIEW` | - | Yes | Yes | Yes |
| `INBOX` | - | Yes | Yes | Yes |
| `WHATSAPP_INBOX` | - | - | Yes | Yes |
| `INSTAGRAM_INBOX` | - | - | Yes | Yes |
| `CHATWOOT` | - | - | Yes | Yes |
| `AGENT_NOTIFICATIONS` | - | Yes | Yes | Yes |
| `AGENT_NOTIFICATIONS_INAPP` | - | Yes | Yes | Yes |
| `AGENT_NOTIFICATIONS_EMAIL` | - | Yes | Yes | Yes |
| `AGENT_NOTIFICATIONS_WEBHOOK` | - | Yes | Yes | Yes |
| `TEAM_COLLABORATION` | - | - | Yes | Yes |
| `CUSTOM_BRANDING` | - | - | Yes | Yes |

---

## What Counts as a Message

A **message** is any single LLM call, regardless of source. All of the following count:

| Source | Counts? | Notes |
|---|---|---|
| In-app agent chat (`/api/agents/{id}/chat`) | Yes | Authenticated user chatting with agent |
| Ask AI (`/api/agents/{id}/conversations/ask`) | Yes | Conversation analysis within agent editor |
| Public chat (`/api/public/agents/{agentId}/chat`) | Yes | Anonymous end-user via agent link |
| Hook chat (`/api/hooks/{hookId}/chat`) | Yes | Programmatic API access |
| Hook stream (`/api/hooks/{hookId}/stream`) | Yes | Streaming API access |
| Hook async (`/api/hooks/{hookId}/async`) | Yes | Async API access |
| WhatsApp messages | Yes | Via WhatsApp inbox integration |
| Instagram messages | Yes | Via Instagram inbox integration |
| Embed widget messages | Yes | End-user via embedded widget |

**Not counted:** page views, agent CRUD operations, settings changes, login/logout, file uploads.

---

## Upgrade Paths

```
Free → Pro     : Self-serve, credit card via Stripe
Pro → Team     : Self-serve, minimum 3 seats, per-seat billing
Team → Enterprise : Sales-assisted, custom contract
```

### Downgrade Behavior

- **Team → Pro:** Requires removing all team members except owner. Excess feature flags disabled.
- **Pro → Free:** Features gated by plan are disabled. Existing agents remain but gated features stop working. Usage cap drops to 100/month.
- **Suspension:** If payment fails after grace period, tenant status → `suspended`. All API/hook endpoints return 402. Dashboard accessible in read-only mode for data export.

---

## Revenue Model

### Unit Economics (estimated)

| Metric | Value |
|---|---|
| Average LLM cost per message | ~$0.002–0.004 (varies by model/context) |
| Pro margin per message (included) | ~$0.0018/msg ($19 / 5K msgs - $0.002 cost) |
| Team margin per message (included) | ~$0.0007/msg ($10 / 10K msgs - $0.003 cost) |
| Pro overage margin | ~$0.003/msg ($0.005 - $0.002 cost) |
| Team overage margin | ~$0.001/msg ($0.003 - $0.002 cost) |

### Revenue Levers

1. **Seat expansion** — Team tenants add seats as org grows
2. **Usage overage** — High-traffic agents exceed included allowance
3. **Plan upgrades** — Free → Pro → Team conversion
4. **Enterprise contracts** — Custom pricing for large orgs
