# WhatsApp Business Promotional Messaging - Architecture Plan

## Table of Contents

- [Current State Analysis](#current-state-analysis)
- [Recommended Architecture](#recommended-architecture)
- [Database Schema](#database-schema)
- [Technology Stack](#technology-stack)
- [Core Implementation Components](#core-implementation-components)
- [API Endpoints](#api-endpoints)
- [UI Components](#ui-components)
- [Alternative Option: Third-Party Integration](#alternative-option-third-party-integration)
- [Compliance & Best Practices](#compliance--best-practices)
- [Implementation Timeline](#implementation-timeline)
- [Cost Estimation](#cost-estimation)
- [Recommendation Summary](#recommendation-summary)

---

## Current State Analysis

### What You Have

- **Multi-tenant system** with tenant isolation (`tenants`, `tenant_users` tables)
- **WhatsApp Cloud API integration** (v18.0) for 1:1 conversational messaging
- `whatsapp_agent_connections` table tracking individual phone connections
- Message sending via Meta Graph API (`/lib/whatsapp/sender.ts`)
- **No queue system** or bulk messaging infrastructure

### Key Files & Architecture

**Core WhatsApp Files:**
```
/lib/whatsapp/
  ├── connections.ts ..................... Connection CRUD & queries
  ├── types.ts ........................... TypeScript interfaces
  ├── sender.ts .......................... Message sending logic
  ├── intro-message.ts ................... Welcome message builder
  ├── conversation-manager.ts ............ Conversation lifecycle
  ├── agent-handler.ts ................... Message processing pipeline
  ├── response-formatter.ts .............. Response formatting logic
  └── message-types.ts ................... Message type definitions
```

**API Endpoints:**
```
/app/api/
  ├── webhooks/route.ts .................. Webhook handler (GET/POST)
  ├── messages/send/route.ts ............. Direct message sending API
  └── agents/[id]/whatsapp/
      ├── connections/route.ts ........... Connection CRUD endpoints
      └── connections/[connectionId]/route.ts ... Individual connection actions
```

### Key Constraints

- **WhatsApp API Rate Limits:** ~1000 messages/second per phone number (varies by tier)
- **24-hour session window:** Marketing messages require templates unless within active conversation
- **Opt-in requirement:** Users must consent to promotional messages (GDPR/compliance)
- **Template approval:** WhatsApp requires pre-approved message templates for marketing

---

## Recommended Architecture

### Option A: Queue-Based Bulk Messaging with Template Support

This approach balances scalability, compliance, and cost-effectiveness.

**Why This Approach:**

✅ **Full Control:** You own the infrastructure and can customize extensively
✅ **Cost-Effective:** Only pay for Meta WhatsApp API ($0.01/msg) + Redis ($10-50/mo)
✅ **Scalable:** BullMQ handles millions of messages with proper rate limiting
✅ **Tenant Isolation:** Each tenant manages their own WhatsApp Business accounts
✅ **Compliance-Ready:** Built-in opt-in tracking and template approval workflow

---

## Database Schema

### 1. Tenant WhatsApp Business Accounts

Store WhatsApp Business account credentials per tenant.

```sql
CREATE TABLE tenant_whatsapp_business_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- WhatsApp Business API credentials
  phone_number_id TEXT NOT NULL, -- Meta Phone Number ID
  business_account_id TEXT NOT NULL, -- Meta Business Account ID
  access_token TEXT NOT NULL, -- Encrypted token
  phone_number TEXT NOT NULL, -- E.164 format
  phone_number_normalized TEXT NOT NULL, -- Digits only

  -- Account status
  status TEXT NOT NULL DEFAULT 'pending', -- pending|verified|suspended|disconnected
  quality_rating TEXT, -- GREEN|YELLOW|RED (from Meta)
  messaging_limit TEXT, -- TIER_1K|TIER_10K|TIER_100K|TIER_UNLIMITED

  -- Verification
  verified_at TIMESTAMPTZ,
  webhook_verified BOOLEAN DEFAULT false,

  -- Metadata
  display_name TEXT,
  timezone TEXT DEFAULT 'UTC',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, phone_number_normalized)
);

CREATE INDEX idx_whatsapp_business_accounts_tenant
  ON tenant_whatsapp_business_accounts(tenant_id, status);
```

### 2. WhatsApp Message Templates

Store templates approved by WhatsApp for promotional messaging.

```sql
CREATE TABLE whatsapp_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id UUID NOT NULL REFERENCES tenant_whatsapp_business_accounts(id) ON DELETE CASCADE,

  -- Template details
  name TEXT NOT NULL, -- Template identifier (e.g., 'summer_sale_2024')
  language TEXT NOT NULL DEFAULT 'en', -- Language code (en, es, fr, etc.)
  category TEXT NOT NULL, -- MARKETING|UTILITY|AUTHENTICATION

  -- Template structure
  header_type TEXT, -- text|image|video|document
  header_text TEXT,
  header_media_url TEXT,
  body_text TEXT NOT NULL,
  footer_text TEXT,

  -- Variables (stored as JSONB array)
  -- Example: ["customer_name", "discount_amount"]
  variables JSONB DEFAULT '[]'::jsonb,

  -- Buttons (interactive)
  -- Example: [{"type": "url", "text": "Shop Now", "url": "https://..."}]
  buttons JSONB DEFAULT '[]'::jsonb,

  -- Meta approval status
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  meta_template_id TEXT UNIQUE, -- WhatsApp's template ID
  rejection_reason TEXT,

  -- Usage tracking
  total_sent INTEGER DEFAULT 0,
  last_used_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(business_account_id, name, language)
);

CREATE INDEX idx_whatsapp_templates_account
  ON whatsapp_message_templates(business_account_id, status);
```

**Template Example:**

```
Header: "Special Offer 🎉"
Body: "Hi {{1}}, enjoy {{2}}% off on your next purchase! Valid until {{3}}."
Footer: "Reply STOP to unsubscribe"
Button: [{"type": "url", "text": "Shop Now", "url": "https://shop.example.com"}]
```

### 3. Contact Lists

Organize contacts into lists for targeted campaigns.

```sql
CREATE TABLE whatsapp_contact_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,

  -- List metadata
  total_contacts INTEGER DEFAULT 0,
  opted_in_count INTEGER DEFAULT 0,

  -- Tags for segmentation (e.g., ["vip", "newsletter_subscribers"])
  tags JSONB DEFAULT '[]'::jsonb,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_contact_lists_tenant
  ON whatsapp_contact_lists(tenant_id);
```

### 4. Contacts

Store individual contact information with opt-in status.

```sql
CREATE TABLE whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Contact info
  phone_number TEXT NOT NULL, -- E.164 format (+1234567890)
  phone_number_normalized TEXT NOT NULL, -- Digits only (1234567890)
  name TEXT,
  email TEXT,

  -- Opt-in status (CRITICAL FOR COMPLIANCE)
  opted_in BOOLEAN DEFAULT false,
  opted_in_at TIMESTAMPTZ,
  opted_out_at TIMESTAMPTZ,
  opt_in_source TEXT, -- web_form|import|conversation|api

  -- Custom fields for personalization
  -- Example: {"customer_tier": "gold", "last_purchase": "2024-01-15"}
  custom_fields JSONB DEFAULT '{}'::jsonb,

  -- Tags for segmentation
  tags JSONB DEFAULT '[]'::jsonb,

  -- Metadata
  source TEXT, -- import|manual|agent_conversation|api
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, phone_number_normalized)
);

CREATE INDEX idx_whatsapp_contacts_tenant ON whatsapp_contacts(tenant_id, opted_in);
CREATE INDEX idx_whatsapp_contacts_phone ON whatsapp_contacts(phone_number_normalized);
```

### 5. Contact List Membership

Many-to-many relationship between contacts and lists.

```sql
CREATE TABLE whatsapp_contact_list_members (
  contact_id UUID REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  list_id UUID REFERENCES whatsapp_contact_lists(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES auth.users(id),

  PRIMARY KEY (contact_id, list_id)
);

CREATE INDEX idx_contact_list_members_list ON whatsapp_contact_list_members(list_id);
CREATE INDEX idx_contact_list_members_contact ON whatsapp_contact_list_members(contact_id);
```

### 6. Campaigns

Bulk messaging campaigns with scheduling and tracking.

```sql
CREATE TABLE whatsapp_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_account_id UUID NOT NULL REFERENCES tenant_whatsapp_business_accounts(id) ON DELETE CASCADE,

  -- Campaign details
  name TEXT NOT NULL,
  description TEXT,

  -- Template to send
  template_id UUID REFERENCES whatsapp_message_templates(id) ON DELETE RESTRICT,

  -- Template variable values (shared across all recipients)
  -- Example: {"discount_amount": "25", "expiry_date": "Dec 31"}
  template_variables JSONB DEFAULT '{}'::jsonb,

  -- Target audience
  contact_list_ids UUID[] NOT NULL, -- Array of list IDs
  filter_criteria JSONB, -- Additional filters (tags, custom fields)

  -- Scheduling
  status TEXT NOT NULL DEFAULT 'draft', -- draft|scheduled|sending|paused|completed|failed|cancelled
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,

  -- Stats
  total_recipients INTEGER DEFAULT 0,
  messages_sent INTEGER DEFAULT 0,
  messages_delivered INTEGER DEFAULT 0,
  messages_read INTEGER DEFAULT 0,
  messages_failed INTEGER DEFAULT 0,
  messages_pending INTEGER DEFAULT 0,

  -- Rate limiting
  max_messages_per_second INTEGER DEFAULT 20, -- Conservative default

  -- Metadata
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_campaigns_tenant ON whatsapp_campaigns(tenant_id, status);
CREATE INDEX idx_whatsapp_campaigns_status ON whatsapp_campaigns(status, scheduled_at);
```

### 7. Message Queue

Queue items for async message processing.

```sql
CREATE TABLE whatsapp_message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Campaign association
  campaign_id UUID REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
  business_account_id UUID NOT NULL REFERENCES tenant_whatsapp_business_accounts(id) ON DELETE CASCADE,

  -- Recipient
  contact_id UUID REFERENCES whatsapp_contacts(id) ON DELETE SET NULL,
  to_phone_number TEXT NOT NULL,

  -- Message content
  template_id UUID REFERENCES whatsapp_message_templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL, -- Cached for sending
  template_language TEXT NOT NULL,

  -- Template variables for this specific recipient
  -- Example: {"customer_name": "John", "discount_amount": "25"}
  template_variables JSONB DEFAULT '{}'::jsonb,

  -- Queue status
  status TEXT NOT NULL DEFAULT 'pending', -- pending|processing|sent|delivered|read|failed|cancelled
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Result tracking
  whatsapp_message_id TEXT, -- Meta's message ID
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  error_code TEXT, -- Meta error codes (e.g., 131026, 131047)

  -- Scheduling
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_whatsapp_queue_status ON whatsapp_message_queue(status, scheduled_for);
CREATE INDEX idx_whatsapp_queue_campaign ON whatsapp_message_queue(campaign_id, status);
CREATE INDEX idx_whatsapp_queue_pending ON whatsapp_message_queue(status, scheduled_for)
  WHERE status = 'pending';
```

### 8. Row-Level Security (RLS) Policies

Add tenant isolation for all new tables.

```sql
-- Enable RLS
ALTER TABLE tenant_whatsapp_business_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contact_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_queue ENABLE ROW LEVEL SECURITY;

-- Business Accounts: Tenant members only
CREATE POLICY "Tenant members can manage business accounts"
  ON tenant_whatsapp_business_accounts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.user_id = auth.uid()
      AND tenant_users.tenant_id = tenant_whatsapp_business_accounts.tenant_id
    )
  );

-- Templates: Via business account
CREATE POLICY "Tenant members can manage templates"
  ON whatsapp_message_templates
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tenant_whatsapp_business_accounts ba
      JOIN tenant_users tu ON tu.tenant_id = ba.tenant_id
      WHERE ba.id = whatsapp_message_templates.business_account_id
      AND tu.user_id = auth.uid()
    )
  );

-- Contacts: Tenant members only
CREATE POLICY "Tenant members can manage contacts"
  ON whatsapp_contacts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.user_id = auth.uid()
      AND tenant_users.tenant_id = whatsapp_contacts.tenant_id
    )
  );

-- Contact Lists: Tenant members only
CREATE POLICY "Tenant members can manage contact lists"
  ON whatsapp_contact_lists
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.user_id = auth.uid()
      AND tenant_users.tenant_id = whatsapp_contact_lists.tenant_id
    )
  );

-- Campaigns: Tenant members only
CREATE POLICY "Tenant members can manage campaigns"
  ON whatsapp_campaigns
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM tenant_users
      WHERE tenant_users.user_id = auth.uid()
      AND tenant_users.tenant_id = whatsapp_campaigns.tenant_id
    )
  );

-- Message Queue: Service role only (background workers)
CREATE POLICY "Service role can manage queue"
  ON whatsapp_message_queue
  FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Tenant members can view their queue items"
  ON whatsapp_message_queue
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_campaigns c
      JOIN tenant_users tu ON tu.tenant_id = c.tenant_id
      WHERE c.id = whatsapp_message_queue.campaign_id
      AND tu.user_id = auth.uid()
    )
  );
```

---

## Technology Stack

### Required NPM Packages

```json
{
  "dependencies": {
    "bullmq": "^5.0.0",          // Job queue with Redis
    "ioredis": "^5.3.2",          // Redis client for BullMQ
    "node-cron": "^3.0.3",        // Scheduled tasks (campaign scheduler)
    "crypto-js": "^4.2.0",        // Token encryption
    "csv-parse": "^5.5.0",        // CSV contact import
    "papaparse": "^5.4.1"         // CSV parsing (client-side)
  }
}
```

### Infrastructure Requirements

**Redis:**
- **Option 1:** Upstash Redis (serverless, pay-per-request)
  - Free tier: 10k requests/day
  - Pro: $10/month for 100k requests/day
  - Perfect for Next.js serverless

- **Option 2:** Self-hosted Redis
  - Docker container or managed service
  - More control, lower cost at scale

**Environment Variables:**

```bash
# Existing WhatsApp Config
WHATSAPP_PHONE_NUMBER_ID=<your-phone-id>
WHATSAPP_ACCESS_TOKEN=<your-token>
VERIFY_TOKEN=<webhook-verification-token>

# New: Redis for Queue
REDIS_URL=redis://localhost:6379
# OR for Upstash:
REDIS_URL=rediss://:password@region.upstash.io:6379

# Encryption (for storing access tokens)
ENCRYPTION_KEY=<generate-with-openssl-rand-hex-32>
```

---

## Core Implementation Components

### 1. Business Account Management

**File:** `/lib/whatsapp/business-accounts.ts`

```typescript
import { createClient } from '@/lib/supabase/server';
import CryptoJS from 'crypto-js';

interface ConnectAccountParams {
  tenantId: string;
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  displayName?: string;
  userId: string;
}

interface WhatsAppBusinessAccount {
  id: string;
  tenant_id: string;
  phone_number_id: string;
  business_account_id: string;
  phone_number: string;
  status: 'pending' | 'verified' | 'suspended' | 'disconnected';
  quality_rating?: 'GREEN' | 'YELLOW' | 'RED';
  messaging_limit?: 'TIER_1K' | 'TIER_10K' | 'TIER_100K' | 'TIER_UNLIMITED';
  display_name?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Encrypt access token before storing in database
 */
function encryptToken(token: string): string {
  const key = process.env.ENCRYPTION_KEY!;
  return CryptoJS.AES.encrypt(token, key).toString();
}

/**
 * Decrypt access token for API calls
 */
export function decryptToken(encryptedToken: string): string {
  const key = process.env.ENCRYPTION_KEY!;
  const bytes = CryptoJS.AES.decrypt(encryptedToken, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

/**
 * Connect a WhatsApp Business Account to a tenant
 */
export async function connectWhatsAppBusinessAccount(
  params: ConnectAccountParams
): Promise<WhatsAppBusinessAccount> {
  const supabase = await createClient();

  // 1. Verify the phone number exists in Meta
  const phoneInfo = await verifyPhoneNumberWithMeta(
    params.phoneNumberId,
    params.accessToken
  );

  // 2. Encrypt the access token
  const encryptedToken = encryptToken(params.accessToken);

  // 3. Insert into database
  const { data, error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .insert({
      tenant_id: params.tenantId,
      phone_number_id: params.phoneNumberId,
      business_account_id: params.businessAccountId,
      access_token: encryptedToken,
      phone_number: phoneInfo.display_phone_number,
      phone_number_normalized: phoneInfo.display_phone_number.replace(/\D/g, ''),
      display_name: params.displayName || phoneInfo.verified_name,
      status: 'pending',
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/**
 * Verify phone number exists in Meta Graph API
 */
async function verifyPhoneNumberWithMeta(
  phoneNumberId: string,
  accessToken: string
): Promise<{
  display_phone_number: string;
  verified_name: string;
  quality_rating: string;
}> {
  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Meta API Error: ${error.error.message}`);
  }

  return await response.json();
}

/**
 * Sync account status from Meta (quality rating, messaging limits)
 */
export async function syncAccountStatus(accountId: string): Promise<void> {
  const supabase = await createClient();

  // 1. Get account
  const { data: account, error: fetchError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (fetchError) throw fetchError;

  // 2. Decrypt token
  const accessToken = decryptToken(account.access_token);

  // 3. Fetch from Meta
  const phoneInfo = await verifyPhoneNumberWithMeta(
    account.phone_number_id,
    accessToken
  );

  // 4. Update database
  const { error: updateError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .update({
      quality_rating: phoneInfo.quality_rating,
      status: 'verified',
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (updateError) throw updateError;
}

/**
 * Disconnect a WhatsApp Business Account
 */
export async function disconnectBusinessAccount(accountId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .update({
      status: 'disconnected',
      updated_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (error) throw error;
}

/**
 * List business accounts for a tenant
 */
export async function listBusinessAccounts(
  tenantId: string
): Promise<WhatsAppBusinessAccount[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data;
}
```

### 2. Template Management

**File:** `/lib/whatsapp/templates.ts`

```typescript
import { createClient } from '@/lib/supabase/server';
import { decryptToken } from './business-accounts';

interface CreateTemplateParams {
  businessAccountId: string;
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  bodyText: string;
  headerType?: 'text' | 'image' | 'video' | 'document';
  headerText?: string;
  footerText?: string;
  variables?: string[];
  buttons?: TemplateButton[];
}

interface TemplateButton {
  type: 'url' | 'phone_number' | 'quick_reply';
  text: string;
  url?: string;
  phone_number?: string;
}

interface MessageTemplate {
  id: string;
  business_account_id: string;
  name: string;
  language: string;
  category: string;
  body_text: string;
  variables: string[];
  status: 'pending' | 'approved' | 'rejected';
  meta_template_id?: string;
  created_at: string;
}

/**
 * Create a message template and submit to Meta for approval
 */
export async function createMessageTemplate(
  params: CreateTemplateParams
): Promise<MessageTemplate> {
  const supabase = await createClient();

  // 1. Get business account
  const { data: account, error: accountError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('id', params.businessAccountId)
    .single();

  if (accountError) throw accountError;

  // 2. Submit template to Meta
  const accessToken = decryptToken(account.access_token);
  const metaTemplateId = await submitTemplateToMeta({
    businessAccountId: account.business_account_id,
    accessToken,
    ...params,
  });

  // 3. Store in database
  const { data, error } = await supabase
    .from('whatsapp_message_templates')
    .insert({
      business_account_id: params.businessAccountId,
      name: params.name,
      language: params.language,
      category: params.category,
      header_type: params.headerType,
      header_text: params.headerText,
      body_text: params.bodyText,
      footer_text: params.footerText,
      variables: params.variables || [],
      buttons: params.buttons || [],
      status: 'pending',
      meta_template_id: metaTemplateId,
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/**
 * Submit template to Meta WhatsApp Business API
 */
async function submitTemplateToMeta(params: {
  businessAccountId: string;
  accessToken: string;
  name: string;
  category: string;
  language: string;
  bodyText: string;
  headerType?: string;
  headerText?: string;
  footerText?: string;
  buttons?: TemplateButton[];
}): Promise<string> {
  const url = `https://graph.facebook.com/v18.0/${params.businessAccountId}/message_templates`;

  const components: any[] = [];

  // Header component
  if (params.headerType && params.headerText) {
    components.push({
      type: 'HEADER',
      format: params.headerType.toUpperCase(),
      text: params.headerText,
    });
  }

  // Body component
  components.push({
    type: 'BODY',
    text: params.bodyText,
  });

  // Footer component
  if (params.footerText) {
    components.push({
      type: 'FOOTER',
      text: params.footerText,
    });
  }

  // Buttons component
  if (params.buttons && params.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: params.buttons.map(btn => ({
        type: btn.type.toUpperCase(),
        text: btn.text,
        ...(btn.url && { url: btn.url }),
        ...(btn.phone_number && { phone_number: btn.phone_number }),
      })),
    });
  }

  const payload = {
    name: params.name,
    language: params.language,
    category: params.category,
    components,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Meta API Error: ${data.error.message}`);
  }

  return data.id; // Meta's template ID
}

/**
 * Sync template status from Meta
 */
export async function syncTemplateStatus(templateId: string): Promise<void> {
  const supabase = await createClient();

  // 1. Get template
  const { data: template, error: templateError } = await supabase
    .from('whatsapp_message_templates')
    .select('*, tenant_whatsapp_business_accounts(*)')
    .eq('id', templateId)
    .single();

  if (templateError) throw templateError;

  // 2. Fetch from Meta
  const accessToken = decryptToken(template.tenant_whatsapp_business_accounts.access_token);
  const url = `https://graph.facebook.com/v18.0/${template.meta_template_id}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  // 3. Update status
  const { error: updateError } = await supabase
    .from('whatsapp_message_templates')
    .update({
      status: data.status.toLowerCase(),
      ...(data.status === 'REJECTED' && { rejection_reason: data.rejected_reason }),
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId);

  if (updateError) throw updateError;
}

/**
 * Get approved templates for a business account
 */
export async function getApprovedTemplates(
  businessAccountId: string
): Promise<MessageTemplate[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_message_templates')
    .select('*')
    .eq('business_account_id', businessAccountId)
    .eq('status', 'approved')
    .order('created_at', { ascending: false });

  if (error) throw error;

  return data;
}
```

### 3. Contact Management

**File:** `/lib/whatsapp/contacts.ts`

```typescript
import { createClient } from '@/lib/supabase/server';
import { parse } from 'csv-parse/sync';

interface CreateContactParams {
  tenantId: string;
  phoneNumber: string;
  name?: string;
  email?: string;
  optedIn: boolean;
  optInSource?: string;
  customFields?: Record<string, any>;
  tags?: string[];
}

interface Contact {
  id: string;
  tenant_id: string;
  phone_number: string;
  name?: string;
  opted_in: boolean;
  opted_in_at?: string;
  custom_fields: Record<string, any>;
  tags: string[];
  created_at: string;
}

/**
 * Validate and normalize phone number
 */
function validatePhoneNumber(phoneNumber: string): {
  isValid: boolean;
  normalized: string;
  e164: string;
} {
  // Remove all non-digit characters
  const normalized = phoneNumber.replace(/\D/g, '');

  // Basic validation (E.164 format: + followed by 7-15 digits)
  const e164 = phoneNumber.startsWith('+') ? phoneNumber : `+${normalized}`;
  const isValid = /^\+[1-9]\d{7,14}$/.test(e164);

  return { isValid, normalized, e164 };
}

/**
 * Create a single contact
 */
export async function createContact(params: CreateContactParams): Promise<Contact> {
  const supabase = await createClient();

  const { isValid, normalized, e164 } = validatePhoneNumber(params.phoneNumber);

  if (!isValid) {
    throw new Error('Invalid phone number format. Must be E.164 format.');
  }

  const { data, error } = await supabase
    .from('whatsapp_contacts')
    .insert({
      tenant_id: params.tenantId,
      phone_number: e164,
      phone_number_normalized: normalized,
      name: params.name,
      email: params.email,
      opted_in: params.optedIn,
      opted_in_at: params.optedIn ? new Date().toISOString() : null,
      opt_in_source: params.optInSource || 'manual',
      custom_fields: params.customFields || {},
      tags: params.tags || [],
      source: 'manual',
    })
    .select()
    .single();

  if (error) {
    // Handle duplicate phone number
    if (error.code === '23505') {
      throw new Error('Contact with this phone number already exists.');
    }
    throw error;
  }

  return data;
}

/**
 * Import contacts from CSV
 */
export async function importContacts(params: {
  tenantId: string;
  csvContent: string;
  listId?: string;
  autoOptIn?: boolean;
  userId: string;
}): Promise<{ imported: number; errors: string[]; contactIds: string[] }> {
  const supabase = await createClient();

  // Parse CSV
  const records = parse(params.csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const errors: string[] = [];
  const contactIds: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];

    try {
      // Validate required field
      if (!record.phone_number) {
        errors.push(`Row ${i + 1}: Missing phone_number`);
        continue;
      }

      const { isValid, normalized, e164 } = validatePhoneNumber(record.phone_number);

      if (!isValid) {
        errors.push(`Row ${i + 1}: Invalid phone number "${record.phone_number}"`);
        continue;
      }

      // Upsert contact
      const { data, error } = await supabase
        .from('whatsapp_contacts')
        .upsert(
          {
            tenant_id: params.tenantId,
            phone_number: e164,
            phone_number_normalized: normalized,
            name: record.name || null,
            email: record.email || null,
            opted_in: params.autoOptIn || record.opted_in === 'true',
            opted_in_at: params.autoOptIn ? new Date().toISOString() : null,
            opt_in_source: 'import',
            custom_fields: {
              ...(record.custom_fields ? JSON.parse(record.custom_fields) : {}),
            },
            tags: record.tags ? record.tags.split(',').map((t: string) => t.trim()) : [],
            source: 'import',
          },
          { onConflict: 'tenant_id,phone_number_normalized' }
        )
        .select()
        .single();

      if (error) {
        errors.push(`Row ${i + 1}: ${error.message}`);
        continue;
      }

      contactIds.push(data.id);

      // Add to list if specified
      if (params.listId) {
        await supabase.from('whatsapp_contact_list_members').insert({
          contact_id: data.id,
          list_id: params.listId,
          added_by: params.userId,
        });
      }
    } catch (err: any) {
      errors.push(`Row ${i + 1}: ${err.message}`);
    }
  }

  return {
    imported: contactIds.length,
    errors,
    contactIds,
  };
}

/**
 * Update opt-in status
 */
export async function updateOptInStatus(
  contactId: string,
  optedIn: boolean
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_contacts')
    .update({
      opted_in: optedIn,
      [optedIn ? 'opted_in_at' : 'opted_out_at']: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId);

  if (error) throw error;
}

/**
 * Create contact list
 */
export async function createContactList(params: {
  tenantId: string;
  name: string;
  description?: string;
  contactIds?: string[];
  userId: string;
}): Promise<{ id: string; name: string }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_contact_lists')
    .insert({
      tenant_id: params.tenantId,
      name: params.name,
      description: params.description,
      total_contacts: params.contactIds?.length || 0,
      created_by: params.userId,
    })
    .select()
    .single();

  if (error) throw error;

  // Add contacts to list
  if (params.contactIds && params.contactIds.length > 0) {
    const members = params.contactIds.map(contactId => ({
      contact_id: contactId,
      list_id: data.id,
      added_by: params.userId,
    }));

    await supabase.from('whatsapp_contact_list_members').insert(members);
  }

  return data;
}

/**
 * Get contacts for a list
 */
export async function getListContacts(listId: string): Promise<Contact[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_contact_list_members')
    .select('whatsapp_contacts(*)')
    .eq('list_id', listId);

  if (error) throw error;

  return data.map(item => item.whatsapp_contacts);
}
```

### 4. Campaign Management

**File:** `/lib/whatsapp/campaigns.ts`

```typescript
import { createClient } from '@/lib/supabase/server';
import { messageQueue } from './queue-worker';

interface CreateCampaignParams {
  tenantId: string;
  businessAccountId: string;
  name: string;
  description?: string;
  templateId: string;
  templateVariables?: Record<string, string>;
  contactListIds: string[];
  filterCriteria?: any;
  scheduledAt?: Date;
  maxMessagesPerSecond?: number;
  userId: string;
}

interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  status: string;
  total_recipients: number;
  messages_sent: number;
  messages_delivered: number;
  messages_failed: number;
  created_at: string;
}

/**
 * Create a new campaign
 */
export async function createCampaign(
  params: CreateCampaignParams
): Promise<Campaign> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_campaigns')
    .insert({
      tenant_id: params.tenantId,
      business_account_id: params.businessAccountId,
      name: params.name,
      description: params.description,
      template_id: params.templateId,
      template_variables: params.templateVariables || {},
      contact_list_ids: params.contactListIds,
      filter_criteria: params.filterCriteria,
      status: params.scheduledAt ? 'scheduled' : 'draft',
      scheduled_at: params.scheduledAt?.toISOString(),
      max_messages_per_second: params.maxMessagesPerSecond || 20,
      created_by: params.userId,
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/**
 * Start a campaign (queue all messages)
 */
export async function startCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient();

  // 1. Get campaign details
  const { data: campaign, error: campaignError } = await supabase
    .from('whatsapp_campaigns')
    .select(`
      *,
      whatsapp_message_templates(*),
      tenant_whatsapp_business_accounts(*)
    `)
    .eq('id', campaignId)
    .single();

  if (campaignError) throw campaignError;

  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    throw new Error('Campaign must be in draft or scheduled status to start');
  }

  // 2. Get all contacts from specified lists
  const { data: members, error: membersError } = await supabase
    .from('whatsapp_contact_list_members')
    .select('whatsapp_contacts(*)')
    .in('list_id', campaign.contact_list_ids);

  if (membersError) throw membersError;

  // Filter opted-in contacts only
  const contacts = members
    .map(m => m.whatsapp_contacts)
    .filter(c => c.opted_in);

  if (contacts.length === 0) {
    throw new Error('No opted-in contacts found in selected lists');
  }

  // 3. Update campaign status
  const { error: updateError } = await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'sending',
      started_at: new Date().toISOString(),
      total_recipients: contacts.length,
      messages_pending: contacts.length,
    })
    .eq('id', campaignId);

  if (updateError) throw updateError;

  // 4. Queue all messages
  const queueItems = contacts.map(contact => ({
    campaign_id: campaignId,
    business_account_id: campaign.business_account_id,
    contact_id: contact.id,
    to_phone_number: contact.phone_number,
    template_id: campaign.template_id,
    template_name: campaign.whatsapp_message_templates.name,
    template_language: campaign.whatsapp_message_templates.language,
    template_variables: {
      ...campaign.template_variables,
      // Personalize with contact data
      customer_name: contact.name || 'Customer',
      ...contact.custom_fields,
    },
    status: 'pending',
    max_attempts: 3,
  }));

  // Insert queue items in batches
  const batchSize = 1000;
  for (let i = 0; i < queueItems.length; i += batchSize) {
    const batch = queueItems.slice(i, i + batchSize);
    const { error: queueError } = await supabase
      .from('whatsapp_message_queue')
      .insert(batch);

    if (queueError) throw queueError;
  }

  // 5. Trigger queue processor
  await processMessageQueue(campaignId);
}

/**
 * Process message queue for a campaign
 */
async function processMessageQueue(campaignId: string): Promise<void> {
  const supabase = await createClient();

  // Get pending messages
  const { data: messages, error } = await supabase
    .from('whatsapp_message_queue')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('status', 'pending')
    .order('created_at')
    .limit(1000); // Process in batches

  if (error) throw error;

  // Add to BullMQ queue with rate limiting
  for (const message of messages) {
    await messageQueue.add(
      'send-template-message',
      { queueItemId: message.id },
      {
        attempts: message.max_attempts,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
      }
    );
  }
}

/**
 * Pause campaign
 */
export async function pauseCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'paused',
      paused_at: new Date().toISOString(),
    })
    .eq('id', campaignId);

  if (error) throw error;

  // Cancel pending queue jobs (BullMQ implementation)
  // TODO: Implement queue job cancellation
}

/**
 * Resume campaign
 */
export async function resumeCampaign(campaignId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'sending',
      paused_at: null,
    })
    .eq('id', campaignId);

  if (error) throw error;

  await processMessageQueue(campaignId);
}

/**
 * Get campaign statistics
 */
export async function getCampaignStats(campaignId: string): Promise<{
  campaign: Campaign;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
}> {
  const supabase = await createClient();

  const { data: campaign, error } = await supabase
    .from('whatsapp_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();

  if (error) throw error;

  const deliveryRate = campaign.total_recipients > 0
    ? (campaign.messages_delivered / campaign.total_recipients) * 100
    : 0;

  const readRate = campaign.messages_delivered > 0
    ? (campaign.messages_read / campaign.messages_delivered) * 100
    : 0;

  const failureRate = campaign.total_recipients > 0
    ? (campaign.messages_failed / campaign.total_recipients) * 100
    : 0;

  return {
    campaign,
    deliveryRate,
    readRate,
    failureRate,
  };
}
```

### 5. Queue Worker

**File:** `/lib/whatsapp/queue-worker.ts`

```typescript
import { Queue, Worker, QueueScheduler } from 'bullmq';
import Redis from 'ioredis';
import { createClient } from '@/lib/supabase/service-client';
import { decryptToken } from './business-accounts';
import { sendTemplateMessage } from './template-sender';

// Initialize Redis connection
const connection = new Redis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

// Create message queue
export const messageQueue = new Queue('whatsapp-messages', { connection });

// Queue scheduler for delayed jobs
export const queueScheduler = new QueueScheduler('whatsapp-messages', { connection });

/**
 * Worker to process WhatsApp messages
 */
export const messageWorker = new Worker(
  'whatsapp-messages',
  async (job) => {
    const { queueItemId } = job.data;

    const supabase = createClient();

    // 1. Get message from queue
    const { data: queueItem, error: fetchError } = await supabase
      .from('whatsapp_message_queue')
      .select(`
        *,
        tenant_whatsapp_business_accounts(*)
      `)
      .eq('id', queueItemId)
      .single();

    if (fetchError) throw fetchError;

    // Skip if already processed or cancelled
    if (queueItem.status !== 'pending') {
      return { skipped: true, status: queueItem.status };
    }

    // 2. Mark as processing
    await supabase
      .from('whatsapp_message_queue')
      .update({ status: 'processing', attempts: queueItem.attempts + 1 })
      .eq('id', queueItemId);

    try {
      // 3. Decrypt access token
      const accessToken = decryptToken(
        queueItem.tenant_whatsapp_business_accounts.access_token
      );

      // 4. Send message via WhatsApp API
      const result = await sendTemplateMessage({
        phoneNumberId: queueItem.tenant_whatsapp_business_accounts.phone_number_id,
        accessToken,
        to: queueItem.to_phone_number,
        templateName: queueItem.template_name,
        language: queueItem.template_language,
        variables: queueItem.template_variables,
      });

      // 5. Update queue item as sent
      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: 'sent',
          whatsapp_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          processed_at: new Date().toISOString(),
        })
        .eq('id', queueItemId);

      // 6. Update campaign stats
      await supabase.rpc('increment_campaign_sent', {
        campaign_id: queueItem.campaign_id,
      });

      return { success: true, messageId: result.messageId };
    } catch (error: any) {
      // 7. Handle failure
      const isLastAttempt = queueItem.attempts + 1 >= queueItem.max_attempts;

      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: isLastAttempt ? 'failed' : 'pending',
          failed_at: isLastAttempt ? new Date().toISOString() : null,
          error_message: error.message,
          error_code: error.code,
          processed_at: new Date().toISOString(),
        })
        .eq('id', queueItemId);

      if (isLastAttempt) {
        await supabase.rpc('increment_campaign_failed', {
          campaign_id: queueItem.campaign_id,
        });
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: 20, // Process 20 messages concurrently
    limiter: {
      max: 20, // Max 20 jobs per interval
      duration: 1000, // Per second (adjustable based on account tier)
    },
  }
);

// Event handlers
messageWorker.on('completed', (job, result) => {
  console.log(`✅ Job ${job.id} completed:`, result);
});

messageWorker.on('failed', (job, err) => {
  console.error(`❌ Job ${job?.id} failed:`, err.message);
});

messageWorker.on('error', (err) => {
  console.error('Worker error:', err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await messageWorker.close();
  await connection.quit();
});
```

### 6. Template Message Sender

**File:** `/lib/whatsapp/template-sender.ts`

```typescript
interface SendTemplateMessageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  language: string;
  variables?: Record<string, string>;
  headerMedia?: {
    type: 'image' | 'video' | 'document';
    url: string;
  };
}

interface WhatsAppAPIResponse {
  messages?: Array<{ id: string }>;
  error?: {
    message: string;
    code: number;
    error_data?: any;
  };
}

export class WhatsAppAPIError extends Error {
  code: number;

  constructor(message: string, code: number) {
    super(message);
    this.code = code;
    this.name = 'WhatsAppAPIError';
  }
}

/**
 * Build template components from variables
 */
function buildTemplateComponents(
  variables?: Record<string, string>,
  headerMedia?: { type: string; url: string }
): any[] {
  const components: any[] = [];

  // Header component (if media)
  if (headerMedia) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: headerMedia.type,
          [headerMedia.type]: {
            link: headerMedia.url,
          },
        },
      ],
    });
  }

  // Body component (if variables)
  if (variables && Object.keys(variables).length > 0) {
    components.push({
      type: 'body',
      parameters: Object.values(variables).map(value => ({
        type: 'text',
        text: value,
      })),
    });
  }

  return components;
}

/**
 * Send a template message via WhatsApp Business API
 */
export async function sendTemplateMessage(
  params: SendTemplateMessageParams
): Promise<{ messageId: string }> {
  const url = `https://graph.facebook.com/v18.0/${params.phoneNumberId}/messages`;

  const payload: any = {
    messaging_product: 'whatsapp',
    to: params.to,
    type: 'template',
    template: {
      name: params.templateName,
      language: { code: params.language },
    },
  };

  // Add components if variables or media provided
  const components = buildTemplateComponents(params.variables, params.headerMedia);
  if (components.length > 0) {
    payload.template.components = components;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data: WhatsAppAPIResponse = await response.json();

  if (!response.ok || data.error) {
    throw new WhatsAppAPIError(
      data.error?.message || 'Unknown error',
      data.error?.code || 500
    );
  }

  return { messageId: data.messages![0].id };
}
```

### 7. Database Helper Functions

**File:** `/supabase/migrations/[timestamp]_campaign_functions.sql`

```sql
-- Increment campaign sent count
CREATE OR REPLACE FUNCTION increment_campaign_sent(campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE whatsapp_campaigns
  SET
    messages_sent = messages_sent + 1,
    messages_pending = GREATEST(messages_pending - 1, 0),
    updated_at = NOW()
  WHERE id = campaign_id;
END;
$$ LANGUAGE plpgsql;

-- Increment campaign failed count
CREATE OR REPLACE FUNCTION increment_campaign_failed(campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE whatsapp_campaigns
  SET
    messages_failed = messages_failed + 1,
    messages_pending = GREATEST(messages_pending - 1, 0),
    updated_at = NOW()
  WHERE id = campaign_id;
END;
$$ LANGUAGE plpgsql;

-- Mark campaign as completed
CREATE OR REPLACE FUNCTION check_campaign_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if all messages are processed
  IF (
    SELECT COUNT(*)
    FROM whatsapp_message_queue
    WHERE campaign_id = NEW.campaign_id
    AND status IN ('pending', 'processing')
  ) = 0 THEN
    UPDATE whatsapp_campaigns
    SET
      status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE id = NEW.campaign_id
    AND status = 'sending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger on queue status change
CREATE TRIGGER trigger_check_campaign_completion
AFTER UPDATE OF status ON whatsapp_message_queue
FOR EACH ROW
WHEN (NEW.status IN ('sent', 'failed'))
EXECUTE FUNCTION check_campaign_completion();
```

---

## API Endpoints

### Business Account Management

#### Connect WhatsApp Business Account
```
POST /api/tenants/[id]/whatsapp/business-accounts
```

**Request Body:**
```json
{
  "phoneNumberId": "123456789",
  "businessAccountId": "987654321",
  "accessToken": "EAAG...",
  "displayName": "My Business"
}
```

**Response:**
```json
{
  "id": "uuid",
  "tenant_id": "uuid",
  "phone_number": "+1234567890",
  "status": "pending",
  "created_at": "2024-01-01T00:00:00Z"
}
```

#### List Business Accounts
```
GET /api/tenants/[id]/whatsapp/business-accounts
```

#### Sync Account Status
```
POST /api/whatsapp/business-accounts/[id]/sync
```

#### Disconnect Account
```
DELETE /api/whatsapp/business-accounts/[id]
```

---

### Template Management

#### Create Template
```
POST /api/whatsapp/business-accounts/[id]/templates
```

**Request Body:**
```json
{
  "name": "summer_sale_2024",
  "category": "MARKETING",
  "language": "en",
  "bodyText": "Hi {{1}}, enjoy {{2}}% off until {{3}}!",
  "footerText": "Reply STOP to unsubscribe",
  "variables": ["customer_name", "discount", "expiry_date"],
  "buttons": [
    {
      "type": "url",
      "text": "Shop Now",
      "url": "https://example.com/sale"
    }
  ]
}
```

#### List Templates
```
GET /api/whatsapp/business-accounts/[id]/templates?status=approved
```

#### Sync Template Status
```
POST /api/whatsapp/templates/[id]/sync
```

---

### Contact Management

#### Create Contact
```
POST /api/tenants/[id]/whatsapp/contacts
```

**Request Body:**
```json
{
  "phoneNumber": "+1234567890",
  "name": "John Doe",
  "email": "john@example.com",
  "optedIn": true,
  "customFields": {
    "customer_tier": "gold"
  },
  "tags": ["vip", "newsletter"]
}
```

#### Import Contacts (CSV)
```
POST /api/tenants/[id]/whatsapp/contacts/import
```

**Request:** `multipart/form-data`
- `file`: CSV file
- `listId`: (optional) Add to list
- `autoOptIn`: (optional) Mark all as opted-in

**CSV Format:**
```csv
phone_number,name,email,opted_in,tags,custom_fields
+1234567890,John Doe,john@example.com,true,"vip,newsletter","{""tier"":""gold""}"
```

#### List Contacts
```
GET /api/tenants/[id]/whatsapp/contacts?opted_in=true&page=1&limit=50
```

#### Create Contact List
```
POST /api/tenants/[id]/whatsapp/contact-lists
```

**Request Body:**
```json
{
  "name": "VIP Customers",
  "description": "High-value customers",
  "contactIds": ["uuid1", "uuid2"]
}
```

#### Add Contacts to List
```
POST /api/whatsapp/contact-lists/[id]/members
```

**Request Body:**
```json
{
  "contactIds": ["uuid1", "uuid2", "uuid3"]
}
```

---

### Campaign Management

#### Create Campaign
```
POST /api/tenants/[id]/whatsapp/campaigns
```

**Request Body:**
```json
{
  "businessAccountId": "uuid",
  "name": "Summer Sale 2024",
  "description": "Promotional campaign for summer sale",
  "templateId": "uuid",
  "templateVariables": {
    "discount": "25",
    "expiry_date": "Dec 31"
  },
  "contactListIds": ["uuid1", "uuid2"],
  "scheduledAt": "2024-06-01T10:00:00Z",
  "maxMessagesPerSecond": 20
}
```

#### List Campaigns
```
GET /api/tenants/[id]/whatsapp/campaigns?status=sending&page=1
```

#### Start Campaign
```
POST /api/whatsapp/campaigns/[id]/start
```

#### Pause Campaign
```
POST /api/whatsapp/campaigns/[id]/pause
```

#### Resume Campaign
```
POST /api/whatsapp/campaigns/[id]/resume
```

#### Get Campaign Stats
```
GET /api/whatsapp/campaigns/[id]/stats
```

**Response:**
```json
{
  "campaign": {
    "id": "uuid",
    "name": "Summer Sale 2024",
    "status": "completed",
    "total_recipients": 1000,
    "messages_sent": 995,
    "messages_delivered": 980,
    "messages_read": 650,
    "messages_failed": 5
  },
  "deliveryRate": 98.5,
  "readRate": 66.3,
  "failureRate": 0.5
}
```

---

## UI Components

### Dashboard Pages

#### 1. WhatsApp Business Accounts
**Route:** `/dashboard/whatsapp/business-accounts`

**Features:**
- Connect new WhatsApp Business account
- Display connected accounts with status indicators
- Show quality rating (GREEN/YELLOW/RED)
- Messaging tier limits
- Sync button to refresh account status
- Disconnect account option

**Components:**
- `BusinessAccountCard` - Display account info
- `ConnectAccountDialog` - Modal to add new account
- `AccountStatusBadge` - Status indicator

---

#### 2. Message Templates
**Route:** `/dashboard/whatsapp/templates`

**Features:**
- Create new template with visual builder
- List all templates with approval status
- Preview template with sample data
- Sync approval status from Meta
- Edit/delete templates

**Components:**
- `TemplateBuilder` - Drag-and-drop template creator
- `TemplatePreview` - WhatsApp message preview
- `TemplateList` - Table of templates
- `VariablePicker` - Insert template variables

**Template Builder UI:**
```
┌─────────────────────────────────────┐
│ Template Name: summer_sale_2024     │
│ Category: ◉ Marketing               │
│ Language: [EN ▼]                    │
├─────────────────────────────────────┤
│ Header (optional):                  │
│ [Image ▼] [Upload Image]            │
├─────────────────────────────────────┤
│ Body: *Required                     │
│ ┌─────────────────────────────────┐ │
│ │ Hi {{1}}, enjoy {{2}}% off      │ │
│ │ until {{3}}!                    │ │
│ └─────────────────────────────────┘ │
│ Variables: [customer_name]          │
│            [discount_amount]        │
│            [expiry_date]            │
├─────────────────────────────────────┤
│ Footer (optional):                  │
│ Reply STOP to unsubscribe           │
├─────────────────────────────────────┤
│ Buttons (optional):                 │
│ [+ Add Button]                      │
│ ┌─────────────────────────────────┐ │
│ │ 🔗 Shop Now                     │ │
│ │ https://example.com/sale        │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ [Cancel]          [Submit to Meta]  │
└─────────────────────────────────────┘
```

---

#### 3. Contacts & Lists
**Route:** `/dashboard/whatsapp/contacts`

**Features:**
- Import contacts from CSV
- Manually add single contact
- Create and manage contact lists
- Filter contacts by tags, opt-in status
- Export contact data
- Bulk opt-in/opt-out management

**Components:**
- `ContactImportDialog` - CSV upload with validation
- `ContactTable` - Sortable, filterable contact list
- `ContactListManager` - Create/edit lists
- `OptInStatusToggle` - Update consent

**Import Flow:**
```
1. Upload CSV → 2. Map Columns → 3. Preview → 4. Import
```

---

#### 4. Campaigns
**Route:** `/dashboard/whatsapp/campaigns`

**Features:**
- Create new campaign wizard
- Select template and target lists
- Set template variable values
- Schedule send time
- Monitor real-time campaign progress
- Pause/resume campaigns
- View detailed analytics

**Components:**
- `CampaignWizard` - Multi-step campaign creator
- `CampaignDashboard` - Real-time stats
- `CampaignList` - Table of all campaigns
- `CampaignAnalytics` - Charts and metrics

**Campaign Creation Wizard:**
```
Step 1: Campaign Details
┌─────────────────────────────────────┐
│ Campaign Name: *                    │
│ ┌─────────────────────────────────┐ │
│ │ Summer Sale 2024                │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Description:                        │
│ ┌─────────────────────────────────┐ │
│ │ Promotional campaign...         │ │
│ └─────────────────────────────────┘ │
│                                     │
│ WhatsApp Account: *                 │
│ [+1234567890 ▼]                     │
└─────────────────────────────────────┘

Step 2: Select Template
┌─────────────────────────────────────┐
│ ○ summer_sale_2024 (EN)            │
│   Hi {{1}}, enjoy {{2}}% off...    │
│                                     │
│ ○ new_product_launch (EN)          │
│   Introducing our latest...        │
└─────────────────────────────────────┘

Step 3: Configure Variables
┌─────────────────────────────────────┐
│ Variable 1: customer_name           │
│ ◉ Use contact name                  │
│ ○ Custom value: [_____]             │
│                                     │
│ Variable 2: discount_amount         │
│ ◉ Custom value: [25    ]            │
│ ○ Use custom field: [Select ▼]     │
└─────────────────────────────────────┘

Step 4: Select Audience
┌─────────────────────────────────────┐
│ ☑ VIP Customers (245 contacts)     │
│ ☑ Newsletter Subscribers (1,203)   │
│ ☐ Recent Buyers (89 contacts)      │
│                                     │
│ Total Recipients: 1,448             │
│ Opted-in: 1,350 (93%)              │
└─────────────────────────────────────┘

Step 5: Schedule
┌─────────────────────────────────────┐
│ ○ Send immediately                  │
│ ◉ Schedule for later                │
│   Date: [Jun 1, 2024 ▼]             │
│   Time: [10:00 AM ▼]                │
│   Timezone: [UTC-5 ▼]               │
│                                     │
│ Rate Limit: [20 ▼] msg/second       │
└─────────────────────────────────────┘

[Back] [Next] [Create Campaign]
```

**Campaign Dashboard:**
```
┌─────────────────────────────────────────────────────┐
│ Summer Sale 2024                        [Pause]     │
│ Status: Sending...                                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ████████████████░░░░░░  65% Complete              │
│                                                     │
│  Total Recipients:     1,350                        │
│  Sent:                  875  (64.8%)               │
│  Delivered:             820  (93.7% of sent)       │
│  Read:                  456  (55.6% of delivered)  │
│  Failed:                 12  (1.4%)                │
│  Pending:               463                         │
│                                                     │
│  Estimated Completion: 15 minutes                   │
│                                                     │
│  [View Detailed Analytics]                          │
└─────────────────────────────────────────────────────┘
```

---

#### 5. Analytics Dashboard
**Route:** `/dashboard/whatsapp/analytics`

**Features:**
- Campaign performance comparison
- Delivery rate trends
- Read rate analysis
- Failed message breakdown
- Best time to send analysis
- Contact engagement scores

**Components:**
- `PerformanceChart` - Line/bar charts
- `DeliveryFunnel` - Sent → Delivered → Read
- `ErrorAnalysis` - Common failure reasons
- `EngagementHeatmap` - Best sending times

---

## Alternative Option: Third-Party Integration

If you prefer to avoid building queue infrastructure, integrate with a third-party WhatsApp Business API provider.

### Recommended Providers

#### 1. **Twilio** (Most Popular)
- **WhatsApp Business API** with built-in compliance
- Template management via Twilio Console
- Webhook support for delivery status
- **Pricing:** $0.005-0.02 per message (varies by country)
- **SDKs:** Node.js, Python, PHP, etc.

**Integration:**
```typescript
import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

await client.messages.create({
  from: 'whatsapp:+14155238886',
  to: 'whatsapp:+1234567890',
  contentSid: 'HX1234...', // Template ID
  contentVariables: JSON.stringify({
    '1': 'John',
    '2': '25',
    '3': 'Dec 31',
  }),
});
```

---

#### 2. **MessageBird**
- Robust bulk messaging with templates
- Advanced analytics dashboard
- Contact management included
- **Pricing:** $0.01-0.015 per message

---

#### 3. **Vonage (Nexmo)**
- Enterprise-grade WhatsApp API
- High deliverability rates
- 24/7 support
- **Pricing:** Custom enterprise pricing

---

### Implementation with Third-Party

**Database Changes:**
- Same schema (minus `whatsapp_message_queue`)
- Add `provider` column to `tenant_whatsapp_business_accounts`
- Store provider-specific IDs

**Code Changes:**
- Replace `/lib/whatsapp/template-sender.ts` with provider SDK
- Add webhook handlers for delivery status
- No Redis/BullMQ needed

**Pros:**
- No queue infrastructure needed
- Compliance handled by provider
- Better deliverability rates
- Enterprise support

**Cons:**
- Higher cost per message
- Vendor lock-in
- Less control over infrastructure

---

## Compliance & Best Practices

### 1. Opt-In Management

**Critical for GDPR/CCPA Compliance:**

✅ **Double Opt-In (Recommended):**
```
1. User submits phone number on web form
2. Send confirmation message: "Reply YES to subscribe"
3. Only mark opted_in=true after confirmation
4. Store consent timestamp
```

✅ **Opt-Out Instructions:**
- Include in every message: "Reply STOP to unsubscribe"
- Immediately honor opt-out requests
- Update `opted_out_at` timestamp

**Implementation:**
```typescript
// Webhook handler for incoming messages
if (messageText.toLowerCase() === 'stop') {
  await updateOptInStatus(contactId, false);
  await sendWhatsAppMessage({
    to: phoneNumber,
    text: "You've been unsubscribed. Reply START to re-subscribe.",
  });
}
```

---

### 2. Template Guidelines

**WhatsApp Template Requirements:**

❌ **Avoid:**
- Overly promotional language ("Buy now!", "Limited time!")
- Misleading content
- Messages longer than 1024 characters

✅ **Do:**
- Provide value (order updates, appointment reminders)
- Keep messages concise and clear
- Use personalization variables
- Include opt-out instructions

**Approval Timeline:**
- Typically 24-48 hours
- Rejections require resubmission with changes

---

### 3. Rate Limiting

**WhatsApp Messaging Tiers:**

| Tier | Daily Limit | How to Reach |
|------|-------------|--------------|
| TIER_1K | 1,000 messages/24h | Default for new accounts |
| TIER_10K | 10,000 messages/24h | Good quality rating for 7 days |
| TIER_100K | 100,000 messages/24h | Good quality for 30 days |
| TIER_UNLIMITED | Unlimited | Enterprise accounts only |

**Quality Rating Impacts:**
- **GREEN:** No restrictions
- **YELLOW:** Tier may be reduced
- **RED:** Messaging disabled

**Best Practices:**
- Start with 20 msg/second (conservative)
- Monitor quality rating daily
- Pause campaigns if quality drops

---

### 4. GDPR Compliance

**Data Rights:**

✅ **Right to Access:**
```typescript
// Export contact data
export async function exportContactData(contactId: string): Promise<any> {
  const supabase = await createClient();

  const { data } = await supabase
    .from('whatsapp_contacts')
    .select(`
      *,
      whatsapp_message_queue(sent_at, delivered_at, status)
    `)
    .eq('id', contactId)
    .single();

  return data;
}
```

✅ **Right to Erasure:**
```typescript
// Delete contact and all associated data
export async function deleteContactData(contactId: string): Promise<void> {
  const supabase = await createClient();

  // Cascade deletes queue items and list memberships
  await supabase
    .from('whatsapp_contacts')
    .delete()
    .eq('id', contactId);
}
```

✅ **Consent Records:**
- Store `opted_in_at`, `opted_out_at`, `opt_in_source`
- Keep audit trail for 3 years (GDPR requirement)

---

### 5. Security Best Practices

**Token Encryption:**
```typescript
// Always encrypt access tokens at rest
import CryptoJS from 'crypto-js';

const encrypted = CryptoJS.AES.encrypt(
  accessToken,
  process.env.ENCRYPTION_KEY
).toString();
```

**Environment Variables:**
```bash
# Use strong random keys
ENCRYPTION_KEY=$(openssl rand -hex 32)
VERIFY_TOKEN=$(openssl rand -hex 32)
```

**RLS Policies:**
- Enforce tenant isolation on all tables
- Service role only for queue workers
- User-based policies for contacts/campaigns

---

## Implementation Timeline

### Phase 1: Foundation (2-3 weeks)

**Week 1:**
- Database migrations (all tables + RLS policies)
- Business account connection flow
- Token encryption setup

**Week 2:**
- Template management (create, sync status)
- Meta Graph API integration
- Template builder UI

**Deliverables:**
- Tenants can connect WhatsApp Business accounts
- Create and submit templates for approval

---

### Phase 2: Bulk Infrastructure (2-3 weeks)

**Week 3:**
- Redis setup (Upstash or self-hosted)
- BullMQ queue implementation
- Queue worker with rate limiting

**Week 4:**
- Contact import (CSV parsing)
- Contact list management
- Campaign creation logic

**Deliverables:**
- Contacts can be imported and organized
- Campaigns can queue thousands of messages

---

### Phase 3: UI & Testing (2 weeks)

**Week 5:**
- Dashboard pages (accounts, templates, contacts)
- Campaign wizard UI
- Real-time campaign monitoring

**Week 6:**
- End-to-end testing
- Performance optimization
- Bug fixes

**Deliverables:**
- Full UI for managing campaigns
- Tested with 1000+ message campaigns

---

### Phase 4: Compliance & Launch (1 week)

**Week 7:**
- Opt-in/opt-out flows
- GDPR data export/deletion
- Rate limiting tuning
- Production deployment

**Deliverables:**
- Production-ready system
- Compliance documentation
- Admin training

---

## Cost Estimation

### Infrastructure Costs

**Monthly Operating Costs:**

| Component | Option | Cost |
|-----------|--------|------|
| Redis (Queue) | Upstash Free | $0 |
| Redis (Queue) | Upstash Pro | $10-50 |
| Redis (Queue) | Self-hosted | ~$10 (VPS) |
| Supabase Storage | First 1GB | $0 |
| Supabase Storage | Additional | $0.021/GB |

**Total Infrastructure:** $10-50/month

---

### WhatsApp Messaging Costs

**Meta WhatsApp Business API Pricing (varies by country):**

| Region | Marketing Message | Utility Message |
|--------|-------------------|-----------------|
| North America | $0.014 | $0.005 |
| Western Europe | $0.016 | $0.006 |
| India | $0.008 | $0.004 |
| Brazil | $0.012 | $0.005 |

**First 1,000 conversations/month:** FREE

**Example Campaign Cost:**
- 10,000 marketing messages to US customers
- Cost: 10,000 × $0.014 = **$140**

---

### Total Cost of Ownership

**Small Tenant (1K messages/month):**
- Infrastructure: $10/month
- WhatsApp: $0 (free tier)
- **Total: $10/month**

**Medium Tenant (50K messages/month):**
- Infrastructure: $30/month
- WhatsApp: 50,000 × $0.014 = $700
- **Total: $730/month**

**Large Tenant (500K messages/month):**
- Infrastructure: $50/month
- WhatsApp: 500,000 × $0.014 = $7,000
- **Total: $7,050/month**

---

## Recommendation Summary

### ✅ Recommended: Option A (Queue-Based Architecture)

**Reasons:**

1. **Full Control:** You own the infrastructure and can customize extensively
2. **Cost-Effective:** Only pay for Meta WhatsApp API + Redis (~$10-50/mo base)
3. **Scalable:** BullMQ handles millions of messages with proper rate limiting
4. **Tenant Isolation:** Each tenant manages their own WhatsApp Business accounts
5. **Compliance-Ready:** Built-in opt-in tracking and template approval workflow

**Key Architecture Highlights:**

✅ **Multi-tenant by design** - Each tenant connects their own WhatsApp Business account
✅ **Template-based messaging** - WhatsApp-compliant promotional messages
✅ **Queue-based processing** - BullMQ with Redis for reliable bulk sending
✅ **Rate limiting built-in** - Respects WhatsApp API limits per account
✅ **Contact management** - Lists, segmentation, and opt-in tracking
✅ **Campaign analytics** - Delivery, read rates, and failure tracking

---

### When to Consider Option B (Third-Party)

**Use third-party providers if:**
- You need faster time-to-market (no queue setup)
- Budget allows for higher per-message costs
- You want enterprise support (SLA, 24/7 help)
- Compliance burden is too high to manage

**Provider Comparison:**

| Provider | Best For | Cost/Message | Support |
|----------|----------|--------------|---------|
| Twilio | Most use cases | $0.005-0.02 | Excellent |
| MessageBird | Analytics focus | $0.01-0.015 | Good |
| Vonage | Enterprise | Custom | 24/7 |

---

## Next Steps

1. **Review and approve architecture**
2. **Choose Redis provider** (Upstash recommended)
3. **Set up WhatsApp Business account** (Meta Business Manager)
4. **Start Phase 1 implementation** (database migrations)

---

**Document Version:** 1.0
**Last Updated:** 2024-02-14
**Author:** VibeAgent Development Team
