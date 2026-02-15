# WhatsApp Bulk Messaging - Complete Implementation Guide

**Status:** Planning & Design Phase
**Feature Flag:** `whatsapp_bulk_messaging`
**Access Control:** Super Admin can enable per tenant
**Architecture:** Database Queue (No Redis) + Meta WhatsApp Business API

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Summary](#architecture-summary)
3. [How It Integrates with Your Current System](#how-it-integrates-with-your-current-system)
4. [Feature Access Flow](#feature-access-flow)
5. [Implementation Phases](#implementation-phases)
6. [Quick Start Guide](#quick-start-guide)
7. [File Structure](#file-structure)
8. [Database Schema Overview](#database-schema-overview)
9. [Admin Dashboard](#admin-dashboard)
10. [Tenant User Experience](#tenant-user-experience)
11. [Key Differences from 1:1 WhatsApp](#key-differences-from-11-whatsapp)
12. [Security & Compliance](#security--compliance)
13. [Testing Strategy](#testing-strategy)
14. [Deployment Checklist](#deployment-checklist)
15. [Troubleshooting](#troubleshooting)
16. [Next Steps](#next-steps)

---

## Overview

### What is WhatsApp Bulk Messaging?

WhatsApp Bulk Messaging allows tenants to send **promotional/marketing messages** to **large contact lists** (hundreds to thousands of recipients) using **pre-approved templates**.

### Use Cases

- **E-commerce:** Send product launch announcements, sales, order updates
- **Healthcare:** Appointment reminders, health tips campaigns
- **Education:** Course enrollment reminders, event notifications
- **Non-profits:** Fundraising campaigns, volunteer coordination

### Key Features

✅ **Tenant-Specific:** Each tenant connects their own Meta WhatsApp Business Account
✅ **Feature-Gated:** Super Admin controls which tenants can access bulk messaging
✅ **Template-Based:** All messages use Meta-approved templates (WhatsApp compliance)
✅ **Queue Processing:** Database queue with cron job (no Redis required)
✅ **Contact Management:** Import CSV, create lists, track opt-in/opt-out
✅ **Campaign Analytics:** Track sent, delivered, read, failed messages
✅ **Rate Limiting:** Configurable messages per second (respects Meta limits)
✅ **Retry Logic:** Exponential backoff for failed messages

---

## Architecture Summary

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│                  SUPER ADMIN                                │
│  Enables "whatsapp_bulk_messaging" feature for Tenant A    │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  TENANT A (Feature Enabled)                 │
│  1. Connect WhatsApp Business Account (Meta credentials)   │
│  2. Create message templates → Submit to Meta              │
│  3. Import contacts from CSV                               │
│  4. Create campaign → Select template + contact lists      │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              CAMPAIGN CREATION (Instant)                    │
│  - Queue 10,000 messages to whatsapp_message_queue         │
│  - Status: 'pending'                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│        VERCEL CRON JOB (Every 30 seconds)                   │
│  GET /api/cron/process-whatsapp-queue                       │
│  - Fetch 20 pending messages                                │
│  - Send via Meta WhatsApp API                               │
│  - Update status: sent/failed                               │
│  - Retry with exponential backoff                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              META WHATSAPP API                              │
│  POST /v18.0/{phone_id}/messages                            │
│  Returns: Message ID                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              WEBHOOK HANDLER                                │
│  POST /api/webhooks/whatsapp-bulk-status                    │
│  Updates: delivered_at, read_at, error_code                 │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Database** | PostgreSQL (Supabase) | Queue, contacts, campaigns |
| **Queue Processing** | Vercel Cron Jobs | Process queue every 30 seconds |
| **WhatsApp API** | Meta Graph API v18.0 | Send template messages |
| **Authentication** | Supabase Auth | User + tenant access control |
| **Rate Limiting** | Database-level | Max 20 msg/30sec by default |
| **Encryption** | CryptoJS AES | Access token encryption |

---

## How It Integrates with Your Current System

### Existing Architecture (Already Built)

Your codebase already has these components that we'll leverage:

#### 1. **Multi-Tenant System**
- **File:** `/supabase/migrations/20251122000000_multi_tenant_system.sql`
- **Tables:** `tenants`, `tenant_users`, `tenant_feature_toggles`, `feature_flags`
- **RLS:** Row Level Security for tenant isolation

#### 2. **Feature Flag System**
- **File:** `/lib/features.ts`
- **Functions:** `isFeatureEnabled()`, `toggleFeature()`
- **Usage:** Already used for `BETA_ANALYTICS`, `ADVANCED_TOOLS`, etc.

#### 3. **Admin Dashboard**
- **Routes:** `/app/admin/tenants/`, `/app/admin/feature-flags/`
- **Components:** `/components/tenants/feature-toggle.tsx`
- **Permission Check:** `isSuperAdmin()` gate

#### 4. **WhatsApp 1:1 Integration**
- **File:** `/supabase/migrations/20260209000000_whatsapp_agent_connections.sql`
- **Table:** `whatsapp_agent_connections` (for conversational agent messaging)
- **Status:** Active, used for agent <-> customer conversations

### New Components (To Be Built)

#### 1. **Bulk Messaging Database Schema**
- **File:** `/supabase/migrations/20260215000000_whatsapp_bulk_messaging_feature.sql`
- **Tables:**
  - `tenant_whatsapp_business_accounts` - Store tenant's Meta credentials
  - `whatsapp_message_templates` - Approved marketing templates
  - `whatsapp_contacts` - Contact database with opt-in tracking
  - `whatsapp_contact_lists` - Organize contacts into lists
  - `whatsapp_campaigns` - Campaign definitions
  - `whatsapp_message_queue` - Async message queue
- **Status:** ✅ Schema created (see migration file)

#### 2. **Backend Implementation**
- **Files to Create:**
  - `/lib/whatsapp-bulk/business-accounts.ts` - Connect/sync accounts
  - `/lib/whatsapp-bulk/templates.ts` - Create/sync templates
  - `/lib/whatsapp-bulk/contacts.ts` - Import CSV, manage contacts
  - `/lib/whatsapp-bulk/campaigns.ts` - Create/start campaigns
  - `/lib/whatsapp-bulk/queue-processor.ts` - Process queue
  - `/lib/whatsapp-bulk/template-sender.ts` - Send via Meta API

#### 3. **API Endpoints**
- **Routes to Create:**
  - `/app/api/tenants/[id]/whatsapp-bulk/business-accounts/route.ts`
  - `/app/api/tenants/[id]/whatsapp-bulk/templates/route.ts`
  - `/app/api/tenants/[id]/whatsapp-bulk/contacts/route.ts`
  - `/app/api/tenants/[id]/whatsapp-bulk/campaigns/route.ts`
  - `/app/api/cron/process-whatsapp-queue/route.ts` (Vercel Cron)
  - `/app/api/webhooks/whatsapp-bulk-status/route.ts`

#### 4. **Tenant Dashboard UI**
- **Routes to Create:**
  - `/app/dashboard/whatsapp-bulk/business-accounts/page.tsx`
  - `/app/dashboard/whatsapp-bulk/templates/page.tsx`
  - `/app/dashboard/whatsapp-bulk/contacts/page.tsx`
  - `/app/dashboard/whatsapp-bulk/campaigns/page.tsx`
  - `/app/dashboard/whatsapp-bulk/analytics/page.tsx`

#### 5. **Admin UI Updates**
- **File to Update:** `/app/admin/tenants/[id]/tabs/features-tab.tsx`
- **Change:** Add toggle for `whatsapp_bulk_messaging` feature flag

### Separation from 1:1 WhatsApp

The bulk messaging system is **completely separate** from the existing 1:1 agent conversations:

| Feature | 1:1 WhatsApp (Existing) | Bulk WhatsApp (New) |
|---------|------------------------|---------------------|
| **Purpose** | Agent conversations | Marketing campaigns |
| **Table** | `whatsapp_agent_connections` | `tenant_whatsapp_business_accounts` |
| **Connection** | Per agent | Per tenant |
| **Message Type** | Text, buttons, lists, flows | Templates only |
| **Volume** | Low (1-100/day) | High (1000s/day) |
| **Approval** | No templates needed | Templates must be approved |
| **Access** | All tenants | Feature flag controlled |

---

## Feature Access Flow

### 1. Super Admin Enables Feature

```typescript
// Admin UI: /app/admin/tenants/[id]/tabs/features-tab.tsx
await toggleFeature(tenantId, 'whatsapp_bulk_messaging', true);
```

### 2. Tenant Sees Bulk Messaging Menu

```typescript
// Sidebar Navigation: /components/sidebar.tsx
{isFeatureEnabled('whatsapp_bulk_messaging') && (
  <SidebarItem href="/dashboard/whatsapp-bulk">
    <MessageSquare />
    WhatsApp Marketing
  </SidebarItem>
)}
```

### 3. Tenant Connects Account

```typescript
// UI: /app/dashboard/whatsapp-bulk/business-accounts/page.tsx
// User fills form with Meta credentials:
// - Phone Number ID
// - Business Account ID
// - Access Token
// - Display Name

// Backend validates and stores
await connectWhatsAppBusinessAccount({
  tenantId,
  phoneNumberId,
  businessAccountId,
  accessToken, // Encrypted before storage
  displayName,
});
```

### 4. API Middleware Checks Feature

```typescript
// Every bulk WhatsApp API endpoint checks:
const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging');
if (!hasAccess) {
  return NextResponse.json(
    { error: 'WhatsApp Bulk Messaging not enabled for this tenant' },
    { status: 403 }
  );
}
```

---

## Implementation Phases

### Phase 0: Feature Flag Setup (Week 0)

**Goal:** Enable feature flag and prepare environment

**Tasks:**
1. ✅ Run database migration: `20260215000000_whatsapp_bulk_messaging_feature.sql`
2. ✅ Verify feature flag in database: `SELECT * FROM feature_flags WHERE name = 'whatsapp_bulk_messaging';`
3. Add `ENCRYPTION_KEY` to `.env.local` (generate with `openssl rand -hex 32`)
4. Add `CRON_SECRET` to `.env.local` (generate with `openssl rand -hex 32`)
5. Update admin UI to show new feature toggle

**Deliverables:**
- [ ] Feature flag exists in database
- [ ] Admin can toggle feature per tenant
- [ ] Environment variables configured

---

### Phase 1: Business Account Integration (Week 1-2)

**Goal:** Allow tenants to connect Meta WhatsApp Business accounts

**Tasks:**
1. Create `/lib/whatsapp-bulk/business-accounts.ts`
   - `connectWhatsAppBusinessAccount()` - Verify + store credentials
   - `verifyPhoneNumberWithMeta()` - Call Meta Graph API
   - `encryptToken()` / `decryptToken()` - Token encryption
   - `syncAccountStatus()` - Fetch quality rating, messaging limits
2. Create API endpoints:
   - `POST /api/tenants/[id]/whatsapp-bulk/business-accounts`
   - `GET /api/tenants/[id]/whatsapp-bulk/business-accounts`
   - `POST /api/whatsapp-bulk/business-accounts/[id]/sync`
3. Create UI: `/app/dashboard/whatsapp-bulk/business-accounts/page.tsx`
   - Form to enter Meta credentials
   - Display connected accounts with status badges
   - Sync button to refresh from Meta
4. Test with Meta test credentials

**Deliverables:**
- [ ] Tenant can connect WhatsApp Business account
- [ ] Access token encrypted in database
- [ ] Account status synced from Meta (quality rating, tier)
- [ ] UI shows connection status

---

### Phase 2: Template Management (Week 3-4)

**Goal:** Create and submit templates to Meta for approval

**Tasks:**
1. Create `/lib/whatsapp-bulk/templates.ts`
   - `createMessageTemplate()` - Build template and submit to Meta
   - `submitTemplateToMeta()` - Call Meta Graph API
   - `syncTemplateStatus()` - Check approval status
   - `getApprovedTemplates()` - List approved templates
2. Create API endpoints:
   - `POST /api/whatsapp-bulk/business-accounts/[id]/templates`
   - `GET /api/whatsapp-bulk/business-accounts/[id]/templates`
   - `POST /api/whatsapp-bulk/templates/[id]/sync`
3. Create UI: `/app/dashboard/whatsapp-bulk/templates/page.tsx`
   - Template builder with visual preview
   - Variable picker ({{1}}, {{2}}, etc.)
   - Button configuration
   - Submit to Meta button
   - Template status badges (pending/approved/rejected)
4. Test template submission

**Deliverables:**
- [ ] Tenant can create templates
- [ ] Templates submitted to Meta for approval
- [ ] Status synced (pending/approved/rejected)
- [ ] Approved templates available for campaigns

---

### Phase 3: Contact Management (Week 5-6)

**Goal:** Import and organize contacts with opt-in tracking

**Tasks:**
1. Create `/lib/whatsapp-bulk/contacts.ts`
   - `createContact()` - Add single contact
   - `importContacts()` - CSV import with validation
   - `validatePhoneNumber()` - E.164 format check
   - `createContactList()` - Create contact list
   - `updateOptInStatus()` - Manage consent
2. Create API endpoints:
   - `POST /api/tenants/[id]/whatsapp-bulk/contacts`
   - `POST /api/tenants/[id]/whatsapp-bulk/contacts/import`
   - `GET /api/tenants/[id]/whatsapp-bulk/contacts`
   - `POST /api/tenants/[id]/whatsapp-bulk/contact-lists`
3. Create UI: `/app/dashboard/whatsapp-bulk/contacts/page.tsx`
   - CSV import dialog with column mapping
   - Contact table with filters (opted-in, tags)
   - Create contact list dialog
   - Add contacts to lists
4. Test CSV import with sample data

**Deliverables:**
- [ ] Tenant can import contacts from CSV
- [ ] Contacts validated (E.164 format)
- [ ] Opt-in status tracked
- [ ] Contact lists created and managed

---

### Phase 4: Campaign & Queue System (Week 7-8)

**Goal:** Create campaigns and process queue with cron job

**Tasks:**
1. Create `/lib/whatsapp-bulk/campaigns.ts`
   - `createCampaign()` - Define campaign
   - `startCampaign()` - Populate queue with messages
   - `pauseCampaign()` / `resumeCampaign()` - Control flow
   - `getCampaignStats()` - Analytics
2. Create `/lib/whatsapp-bulk/queue-processor.ts`
   - `processMessageQueue()` - Main queue worker
   - Fetch 20 pending messages
   - Send via `sendTemplateMessage()`
   - Update status (sent/failed)
   - Retry logic with exponential backoff
3. Create `/lib/whatsapp-bulk/template-sender.ts`
   - `sendTemplateMessage()` - Call Meta Graph API
   - Build template payload with variables
   - Error handling
4. Create API endpoints:
   - `POST /api/tenants/[id]/whatsapp-bulk/campaigns`
   - `GET /api/tenants/[id]/whatsapp-bulk/campaigns`
   - `POST /api/whatsapp-bulk/campaigns/[id]/start`
   - `POST /api/whatsapp-bulk/campaigns/[id]/pause`
   - `GET /api/whatsapp-bulk/campaigns/[id]/stats`
   - `GET /api/cron/process-whatsapp-queue` (Vercel Cron)
5. Configure Vercel cron job in `vercel.json`
6. Test queue processing with small campaign (10 contacts)

**Deliverables:**
- [ ] Tenant can create campaigns
- [ ] Queue populated with pending messages
- [ ] Cron job processes 20 messages every 30 seconds
- [ ] Messages sent via Meta API
- [ ] Retry logic working for failures
- [ ] Campaign auto-completes when queue is empty

---

### Phase 5: UI & Testing (Week 9-10)

**Goal:** Build campaign wizard and real-time monitoring

**Tasks:**
1. Create UI: `/app/dashboard/whatsapp-bulk/campaigns/page.tsx`
   - Multi-step campaign wizard:
     - Step 1: Campaign details (name, description, account)
     - Step 2: Select template
     - Step 3: Configure variables
     - Step 4: Select contact lists
     - Step 5: Schedule (immediate or future)
   - Campaign dashboard with real-time stats
   - Progress bar (% complete)
   - Pause/resume buttons
2. Create UI: `/app/dashboard/whatsapp-bulk/analytics/page.tsx`
   - Campaign performance charts
   - Delivery funnel (sent → delivered → read)
   - Error analysis
3. Create webhook handler: `/app/api/webhooks/whatsapp-bulk-status/route.ts`
   - Handle Meta delivery status updates
   - Update `whatsapp_message_queue` records
   - Update campaign stats
4. End-to-end testing:
   - Create test campaign with 100 contacts
   - Verify queue processing
   - Check delivery status updates
   - Confirm analytics accuracy

**Deliverables:**
- [ ] Campaign wizard functional
- [ ] Real-time campaign monitoring working
- [ ] Webhook receiving delivery status
- [ ] Analytics dashboard showing metrics
- [ ] End-to-end test successful (100 messages)

---

### Phase 6: Compliance & Production (Week 11-12)

**Goal:** GDPR compliance and production readiness

**Tasks:**
1. Add opt-in/opt-out flows:
   - Webhook handler for "STOP" replies
   - Automatic opt-out processing
   - Confirmation messages
2. Add GDPR data export:
   - `GET /api/tenants/[id]/whatsapp-bulk/contacts/[id]/export`
   - Export all contact data + message history
3. Add GDPR data deletion:
   - `DELETE /api/tenants/[id]/whatsapp-bulk/contacts/[id]`
   - Cascade delete from queue and lists
4. Update privacy policy
5. Production deployment:
   - Set environment variables on Vercel
   - Configure Vercel cron job
   - Register webhook URL with Meta
   - Test in production with 1 message
6. Documentation:
   - Update README with usage guide
   - Create tenant onboarding doc
   - Meta setup guide (already created)

**Deliverables:**
- [ ] Opt-in/opt-out automated
- [ ] GDPR data export implemented
- [ ] GDPR data deletion implemented
- [ ] Production deployment successful
- [ ] Webhook verified with Meta
- [ ] Documentation complete

---

## Quick Start Guide

### For Super Admins

**Enable bulk messaging for a tenant:**

1. Go to `/admin/tenants`
2. Click on tenant
3. Go to "Features" tab
4. Toggle **"WhatsApp Bulk Messaging"** to ON
5. Tenant will now see "WhatsApp Marketing" in their sidebar

### For Tenant Admins

**Set up bulk messaging:**

1. **Connect WhatsApp Business Account:**
   - Go to **Settings → WhatsApp Marketing → Business Accounts**
   - Click **"Connect Account"**
   - Follow [Meta Setup Guide](./meta-whatsapp-setup-guide.md)
   - Enter credentials from Meta

2. **Create Message Template:**
   - Go to **Templates**
   - Click **"Create Template"**
   - Design your message (body, header, footer, buttons)
   - Submit to Meta for approval
   - Wait 24-48 hours for approval

3. **Import Contacts:**
   - Go to **Contacts**
   - Click **"Import CSV"**
   - Upload CSV file with columns: `phone_number`, `name`, `email`, `opted_in`
   - Map columns and import

4. **Create Contact List:**
   - Go to **Contact Lists**
   - Click **"Create List"**
   - Name your list (e.g., "VIP Customers")
   - Add contacts to list

5. **Launch Campaign:**
   - Go to **Campaigns**
   - Click **"Create Campaign"**
   - Follow wizard:
     - Enter campaign name
     - Select approved template
     - Configure variables (e.g., discount amount)
     - Select contact lists
     - Schedule (immediate or future)
   - Click **"Launch Campaign"**
   - Monitor real-time progress

---

## File Structure

```
vibeagent/
├── docs/
│   ├── WHATSAPP_BULK_MESSAGING_README.md (This file)
│   ├── whatsapp-bulk-messaging-phased-plan.md (Detailed implementation plan)
│   ├── whatsapp-business-integration-plan.md (Architecture reference)
│   └── meta-whatsapp-setup-guide.md (Meta setup instructions)
│
├── supabase/migrations/
│   └── 20260215000000_whatsapp_bulk_messaging_feature.sql (Database schema)
│
├── lib/whatsapp-bulk/ (To be created)
│   ├── business-accounts.ts
│   ├── templates.ts
│   ├── contacts.ts
│   ├── campaigns.ts
│   ├── queue-processor.ts
│   └── template-sender.ts
│
├── app/api/
│   ├── tenants/[id]/whatsapp-bulk/ (To be created)
│   │   ├── business-accounts/route.ts
│   │   ├── templates/route.ts
│   │   ├── contacts/route.ts
│   │   └── campaigns/route.ts
│   ├── cron/
│   │   └── process-whatsapp-queue/route.ts (To be created)
│   └── webhooks/
│       └── whatsapp-bulk-status/route.ts (To be created)
│
├── app/dashboard/whatsapp-bulk/ (To be created)
│   ├── business-accounts/page.tsx
│   ├── templates/page.tsx
│   ├── contacts/page.tsx
│   ├── campaigns/page.tsx
│   └── analytics/page.tsx
│
├── app/admin/tenants/[id]/tabs/
│   └── features-tab.tsx (Update to show whatsapp_bulk_messaging toggle)
│
├── components/whatsapp-bulk/ (To be created)
│   ├── connect-account-dialog.tsx
│   ├── template-builder.tsx
│   ├── template-preview.tsx
│   ├── contact-import-dialog.tsx
│   ├── campaign-wizard.tsx
│   └── campaign-dashboard.tsx
│
└── vercel.json (Update with cron job config)
```

---

## Database Schema Overview

See full schema in: `/supabase/migrations/20260215000000_whatsapp_bulk_messaging_feature.sql`

### Tables

1. **`tenant_whatsapp_business_accounts`** (1 per tenant)
   - Stores Meta credentials (encrypted)
   - Quality rating, messaging limits
   - Connection status

2. **`whatsapp_message_templates`** (Many per account)
   - Template name, body, footer, buttons
   - Variables ({{1}}, {{2}}, etc.)
   - Meta approval status

3. **`whatsapp_contacts`** (Many per tenant)
   - Phone number, name, email
   - Opt-in status (CRITICAL)
   - Custom fields for personalization

4. **`whatsapp_contact_lists`** (Many per tenant)
   - List name, description
   - Contact counts

5. **`whatsapp_contact_list_members`** (Many-to-many)
   - Links contacts to lists

6. **`whatsapp_campaigns`** (Many per tenant)
   - Campaign name, description
   - Template ID, variables
   - Target lists
   - Stats (sent, delivered, read, failed)

7. **`whatsapp_message_queue`** (Many per campaign)
   - Queue items for processing
   - Status: pending → processing → sent → delivered → read (or failed)
   - Retry counter, error tracking

### RLS Policies

- All tables have Row Level Security enabled
- Tenant isolation via `tenant_users` join
- Service role access for queue processing
- Users can only access their tenant's data

---

## Admin Dashboard

### Enable Feature for Tenant

**Route:** `/admin/tenants/[tenant-id]/tabs/features-tab.tsx`

**UI:**
```
┌─────────────────────────────────────────────┐
│ Feature Flags                               │
├─────────────────────────────────────────────┤
│                                             │
│ ○ Beta Analytics                  [OFF]    │
│ ○ Advanced Tools                  [OFF]    │
│ ● WhatsApp Bulk Messaging         [ON] ✅  │
│   Enable promotional messaging campaigns   │
│                                             │
└─────────────────────────────────────────────┘
```

**Code:**
```typescript
import { toggleFeature } from '@/lib/features';

async function handleToggle(featureName: string, enabled: boolean) {
  await toggleFeature(tenantId, featureName, enabled);
  toast.success(`Feature ${enabled ? 'enabled' : 'disabled'}`);
}
```

---

## Tenant User Experience

### Sidebar Navigation (After Feature Enabled)

```
Dashboard
├── Home
├── Agents
├── Analytics
└── WhatsApp Marketing ✨ NEW
    ├── Business Accounts
    ├── Templates
    ├── Contacts
    ├── Campaigns
    └── Analytics
```

### Campaign Creation Flow

```
Step 1: Campaign Details
┌─────────────────────────────────────┐
│ Name: Summer Sale 2024             │
│ Description: 25% off promotion     │
│ Account: +1234567890               │
└─────────────────────────────────────┘

Step 2: Select Template
┌─────────────────────────────────────┐
│ ● summer_sale_template             │
│   "Hi {{1}}, enjoy {{2}}% off..."  │
│ ○ product_launch                   │
└─────────────────────────────────────┘

Step 3: Configure Variables
┌─────────────────────────────────────┐
│ Variable 1 (customer_name):        │
│ ● Use contact name                 │
│ ○ Custom value: [_____]            │
│                                     │
│ Variable 2 (discount):             │
│ ● Custom value: [25]               │
└─────────────────────────────────────┘

Step 4: Select Audience
┌─────────────────────────────────────┐
│ ☑ VIP Customers (245)              │
│ ☑ Newsletter Subscribers (1,203)   │
│ ☐ Recent Buyers (89)               │
│                                     │
│ Total: 1,448 contacts              │
│ Opted-in: 1,350 (93%)              │
└─────────────────────────────────────┘

Step 5: Schedule
┌─────────────────────────────────────┐
│ ● Send immediately                 │
│ ○ Schedule for later               │
│   Date: [____] Time: [____]        │
│                                     │
│ Rate Limit: [20] msg/second        │
└─────────────────────────────────────┘

[Create Campaign]
```

### Campaign Monitoring

```
┌─────────────────────────────────────┐
│ Summer Sale 2024        [Pause]    │
│ Status: Sending...                 │
├─────────────────────────────────────┤
│ ████████████████░░░░ 65%           │
│                                     │
│ Total:      1,350                  │
│ Sent:        875 (65%)             │
│ Delivered:   820 (94%)             │
│ Read:        456 (56%)             │
│ Failed:       12 (1%)              │
│ Pending:     463                   │
│                                     │
│ Est. Completion: 12 minutes        │
└─────────────────────────────────────┘
```

---

## Key Differences from 1:1 WhatsApp

| Aspect | 1:1 Messaging | Bulk Messaging |
|--------|---------------|----------------|
| **Table** | `whatsapp_agent_connections` | `tenant_whatsapp_business_accounts` |
| **Purpose** | Agent conversations | Marketing campaigns |
| **Volume** | 10-100 msgs/day | 1,000-100,000 msgs/day |
| **Templates** | Not required | Required + Meta approval |
| **Connection** | Per agent | Per tenant |
| **Message Types** | Text, buttons, lists, flows | Templates only |
| **Opt-in** | Not tracked | REQUIRED (GDPR) |
| **Analytics** | Basic (last message time) | Advanced (delivery, read rates) |
| **Rate Limiting** | None | 20 msg/30sec default |
| **Feature Flag** | Always enabled | `whatsapp_bulk_messaging` |
| **Access** | All users | Super Admin controlled |

**Important:** These two systems are **completely independent**. Tenants can use 1:1 messaging for agents and bulk messaging for campaigns simultaneously.

---

## Security & Compliance

### Token Encryption

```typescript
import CryptoJS from 'crypto-js';

// Encrypt before storing
const encryptedToken = CryptoJS.AES.encrypt(
  accessToken,
  process.env.ENCRYPTION_KEY
).toString();

// Decrypt for API calls
const decryptedToken = CryptoJS.AES.decrypt(
  encryptedToken,
  process.env.ENCRYPTION_KEY
).toString(CryptoJS.enc.Utf8);
```

### Opt-In Compliance (GDPR)

**Required Fields:**
- `opted_in` (boolean) - Must be `true` before sending
- `opted_in_at` (timestamp) - Consent timestamp
- `opt_in_source` (string) - How consent was obtained

**Best Practice:**
```typescript
// Only send to opted-in contacts
const contacts = await supabase
  .from('whatsapp_contacts')
  .select('*')
  .eq('tenant_id', tenantId)
  .eq('opted_in', true); // CRITICAL filter
```

### Automatic Opt-Out

```typescript
// Webhook handler for "STOP" replies
if (messageText.toLowerCase().includes('stop')) {
  await supabase
    .from('whatsapp_contacts')
    .update({
      opted_in: false,
      opted_out_at: new Date().toISOString(),
    })
    .eq('phone_number_normalized', senderPhone);

  // Send confirmation
  await sendTextMessage({
    to: senderPhone,
    text: "You've been unsubscribed. Reply START to re-subscribe.",
  });
}
```

### RLS Policies

```sql
-- Tenant isolation
CREATE POLICY "Tenant members only"
  ON whatsapp_contacts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.user_id = auth.uid()
      AND tenant_users.tenant_id = whatsapp_contacts.tenant_id
    )
  );

-- Service role for queue processing
CREATE POLICY "Service role manages queue"
  ON whatsapp_message_queue
  FOR ALL
  USING (auth.role() = 'service_role');
```

---

## Testing Strategy

### Unit Tests

**File:** `/lib/whatsapp-bulk/__tests__/contacts.test.ts`

```typescript
import { validatePhoneNumber } from '../contacts';

describe('Contact Management', () => {
  test('validates E.164 phone numbers', () => {
    const result = validatePhoneNumber('+1234567890');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+1234567890');
  });

  test('rejects invalid phone numbers', () => {
    expect(validatePhoneNumber('invalid').isValid).toBe(false);
  });
});
```

### Integration Tests

**File:** `/lib/whatsapp-bulk/__tests__/campaign.integration.test.ts`

```typescript
describe('Campaign Flow', () => {
  test('creates campaign and queues messages', async () => {
    // 1. Create campaign
    const campaign = await createCampaign({
      tenantId: 'test-tenant',
      businessAccountId: 'test-account',
      name: 'Test Campaign',
      templateId: 'test-template',
      contactListIds: ['test-list'],
    });

    expect(campaign.status).toBe('draft');

    // 2. Start campaign
    await startCampaign(campaign.id);

    // 3. Verify queue populated
    const { data: queueItems } = await supabase
      .from('whatsapp_message_queue')
      .select('*')
      .eq('campaign_id', campaign.id);

    expect(queueItems.length).toBeGreaterThan(0);
  });
});
```

### Manual Testing Checklist

**Phase 1:**
- [ ] Connect WhatsApp Business account
- [ ] Verify token encryption in database
- [ ] Sync account status from Meta
- [ ] Display quality rating and tier

**Phase 2:**
- [ ] Create template with variables
- [ ] Submit to Meta
- [ ] Sync approval status
- [ ] List approved templates

**Phase 3:**
- [ ] Import contacts from CSV
- [ ] Validate phone numbers
- [ ] Create contact list
- [ ] Add contacts to list
- [ ] Toggle opt-in status

**Phase 4:**
- [ ] Create campaign
- [ ] Start campaign
- [ ] Verify queue populated
- [ ] Process queue via cron
- [ ] Check message sent status
- [ ] Verify retry on failure
- [ ] Campaign auto-completes

**Phase 5:**
- [ ] Campaign wizard flows smoothly
- [ ] Real-time stats update
- [ ] Webhook receives delivery status
- [ ] Analytics charts display correctly

**Phase 6:**
- [ ] "STOP" reply opts out contact
- [ ] GDPR data export works
- [ ] GDPR data deletion cascades
- [ ] Production deployment successful

---

## Deployment Checklist

### Pre-Deployment

- [ ] Run database migration: `npx supabase db push`
- [ ] Generate encryption key: `openssl rand -hex 32`
- [ ] Generate cron secret: `openssl rand -hex 32`
- [ ] Add environment variables to Vercel:
  - `ENCRYPTION_KEY`
  - `CRON_SECRET`
  - `WHATSAPP_VERIFY_TOKEN`
- [ ] Configure Vercel cron job in `vercel.json`
- [ ] Build and test locally: `npm run build`

### Deployment

- [ ] Deploy to Vercel: `vercel --prod`
- [ ] Verify cron job appears in Vercel dashboard
- [ ] Test webhook endpoint: `curl https://your-domain.com/api/webhooks/whatsapp-bulk-status`
- [ ] Register webhook with Meta (see [Meta Setup Guide](./meta-whatsapp-setup-guide.md))
- [ ] Enable feature for test tenant
- [ ] Send test campaign (1 message)

### Post-Deployment

- [ ] Monitor cron job execution (Vercel logs)
- [ ] Verify webhook receiving status updates
- [ ] Check queue processing logs
- [ ] Set up error alerts (Sentry/Datadog)
- [ ] Test full campaign (100 messages)
- [ ] Load test (1000+ messages)

---

## Troubleshooting

### Issue: "Feature not enabled" error

**Cause:** Feature flag not toggled for tenant

**Solution:**
1. Go to `/admin/tenants/[id]/tabs/features`
2. Toggle **"WhatsApp Bulk Messaging"** to ON
3. Refresh tenant dashboard

---

### Issue: "Invalid Phone Number ID"

**Cause:** Wrong credentials from Meta

**Solution:**
1. Verify Phone Number ID in [Meta for Developers](https://developers.facebook.com/)
2. Go to **WhatsApp → Getting Started**
3. Copy exact Phone Number ID
4. Re-enter in VibeAgent

---

### Issue: "Template submission failed"

**Cause:** Template doesn't meet Meta guidelines

**Common Reasons:**
- Too promotional ("Buy now!", "Limited offer!")
- Contains spam keywords
- Missing opt-out instructions

**Solution:**
1. Review [Meta Template Guidelines](https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/)
2. Revise template to be informative
3. Add footer: "Reply STOP to unsubscribe"
4. Resubmit

---

### Issue: "Queue not processing"

**Cause:** Cron job not configured or failing

**Solution:**
1. Check `vercel.json`:
   ```json
   {
     "crons": [
       {
         "path": "/api/cron/process-whatsapp-queue",
         "schedule": "*/30 * * * * *"
       }
     ]
   }
   ```
2. Verify cron secret in endpoint:
   ```typescript
   if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
     return new Response('Unauthorized', { status: 401 });
   }
   ```
3. Check Vercel cron logs: `vercel logs --follow`

---

### Issue: "Rate limit exceeded"

**Cause:** Sending too many messages too quickly

**Solution:**
1. Check Meta tier limit (TIER_1K = 1000/day)
2. Reduce `max_messages_per_second` in campaign settings
3. Monitor quality rating (keep it GREEN)
4. Wait for tier upgrade (7-30 days)

---

## Next Steps

### Immediate Actions

1. **Review this README** - Ensure you understand the architecture
2. **Read Meta Setup Guide** - [`meta-whatsapp-setup-guide.md`](./meta-whatsapp-setup-guide.md)
3. **Run database migration** - `npx supabase db push`
4. **Enable feature for test tenant** - Via admin dashboard
5. **Set up Meta test account** - Follow [Meta Setup Guide](./meta-whatsapp-setup-guide.md)

### Implementation Order

Follow the phases in order:

1. ✅ **Phase 0:** Feature flag setup
2. **Phase 1:** Business account integration (Week 1-2)
3. **Phase 2:** Template management (Week 3-4)
4. **Phase 3:** Contact management (Week 5-6)
5. **Phase 4:** Campaign & queue system (Week 7-8)
6. **Phase 5:** UI & testing (Week 9-10)
7. **Phase 6:** Compliance & production (Week 11-12)

### Resources

- **Meta WhatsApp Business API Docs:** https://developers.facebook.com/docs/whatsapp/cloud-api/
- **Template Guidelines:** https://developers.facebook.com/docs/whatsapp/message-templates/guidelines/
- **Error Codes:** https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes/
- **VibeAgent Docs:** [Your internal documentation]

---

**Document Version:** 1.0
**Last Updated:** 2024-02-15
**Total Estimated Time:** 12 weeks (250 hours)
**Maintained By:** VibeAgent Development Team
