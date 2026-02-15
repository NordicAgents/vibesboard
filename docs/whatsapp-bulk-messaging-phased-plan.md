# WhatsApp Bulk Messaging - Phased Development Plan

**Architecture:** Queue-Based with Template Support (Database Queue - No Redis)

**Feature Flag Controlled:** `whatsapp_bulk_messaging` - Super Admin can enable per tenant

**Tenant-Specific:** Each tenant connects their own Meta WhatsApp Business Account

---

## Prerequisites

Before starting implementation, ensure you understand:
1. **Your Current Multi-Tenant System** - See main README for tenant architecture
2. **Meta WhatsApp Business Setup** - See separate guide below
3. **Feature Flag System** - Already implemented in your codebase

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Feature Flag System](#feature-flag-system)
- [Phase 0: Feature Flag Setup](#phase-0-feature-flag-setup-week-0)
- [Phase 1: Business Account Integration](#phase-1-business-account-integration-week-1-2)
- [Phase 2: Template Management](#phase-2-template-management-week-3-4)
- [Phase 3: Contact Management](#phase-3-contact-management-week-5-6)
- [Phase 4: Campaign & Queue System](#phase-4-campaign--queue-system-week-7-8)
- [Phase 5: UI & Testing](#phase-5-ui--testing-week-9-10)
- [Phase 6: Compliance & Production](#phase-6-compliance--production-week-11-12)
- [Testing Strategy](#testing-strategy)
- [Deployment Checklist](#deployment-checklist)

**Note:** For Meta WhatsApp Business setup instructions, see separate document: [`meta-whatsapp-setup-guide.md`](./meta-whatsapp-setup-guide.md)

---

## Architecture Overview

### Key Design Decisions

✅ **Feature Flag Controlled** - Super Admin enables WhatsApp bulk messaging per tenant
✅ **Database-Based Queue** - Uses PostgreSQL instead of Redis
✅ **Template-Based Messaging** - WhatsApp-compliant promotional messages
✅ **Multi-Tenant Isolation** - Each tenant has their own WhatsApp Business account
✅ **Tenant Self-Service** - Tenants connect their own Meta Business accounts
✅ **Vercel Cron Jobs** - Process queue every 30 seconds
✅ **Rate Limiting** - Configurable messages per second
✅ **Retry Logic** - Exponential backoff for failed messages

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     TENANT DASHBOARD                        │
│  (Create Campaigns, Manage Templates, Import Contacts)     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   CAMPAIGN CREATION                         │
│  1. Select Template                                         │
│  2. Choose Contact Lists                                    │
│  3. Set Variables & Schedule                                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              QUEUE POPULATION (Instant)                     │
│  Insert 10,000 rows into whatsapp_message_queue             │
│  Status: 'pending'                                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│          VERCEL CRON JOB (Every 30 seconds)                 │
│  GET /api/cron/process-whatsapp-queue                       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              QUEUE PROCESSOR (Worker)                       │
│  1. Fetch 20 pending messages                               │
│  2. Mark as 'processing'                                    │
│  3. Send via WhatsApp API                                   │
│  4. Update status: 'sent' or 'failed'                       │
│  5. Retry with exponential backoff                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              META WHATSAPP API                              │
│  POST /v18.0/{phone_id}/messages                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              WEBHOOK HANDLER                                │
│  POST /api/webhooks/whatsapp-status                         │
│  Update: delivered_at, read_at, error_code                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature Flag System

### Overview

WhatsApp Bulk Messaging is a **premium feature** controlled by feature flags. Super Admins can enable/disable this feature for each tenant individually.

### Feature Flag: `whatsapp_bulk_messaging`

**Who Can Enable:** `SUPER_ADMIN` only
**Scope:** Per-tenant
**Default:** `false` (disabled)

### Access Control Flow

```
┌─────────────────────────────────────────────────────────┐
│  SUPER ADMIN                                            │
│  └─> Enable feature flag for Tenant A                  │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  TENANT A (Feature Enabled)                             │
│  ✅ Can see "WhatsApp Marketing" tab in dashboard      │
│  ✅ Can connect WhatsApp Business account              │
│  ✅ Can create templates & campaigns                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  TENANT B (Feature Disabled)                            │
│  ❌ Cannot see "WhatsApp Marketing" tab                │
│  ❌ API endpoints return 403 Forbidden                 │
└─────────────────────────────────────────────────────────┘
```

### Implementation

**Database Check:**
```sql
SELECT is_feature_enabled('tenant-uuid', 'whatsapp_bulk_messaging');
-- Returns: true or false
```

**API Middleware:**
```typescript
// Check before allowing access to WhatsApp endpoints
const hasAccess = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging');
if (!hasAccess) {
  return NextResponse.json(
    { error: 'WhatsApp Bulk Messaging not enabled for this tenant' },
    { status: 403 }
  );
}
```

**UI Conditional Rendering:**
```typescript
// Only show if feature enabled
{hasFeature('whatsapp_bulk_messaging') && (
  <WhatsAppMarketingTab />
)}
```

---

## Phase 0: Feature Flag Setup (Week 0)

### Goals
- Set up feature flag for WhatsApp bulk messaging
- Create Super Admin controls
- Prepare development environment

### Tasks

#### 1. Verify Existing Feature Flag System

Your codebase already has feature flags! Verify the setup:

**Check Tables Exist:**
```sql
-- Should already exist from multi-tenant migration
SELECT * FROM feature_flags WHERE name = 'whatsapp_bulk_messaging';
SELECT * FROM tenant_feature_toggles;
```

**Check Helper Function:**
```sql
-- Should already exist
SELECT is_feature_enabled('tenant-id', 'whatsapp_bulk_messaging');
```

#### 2. Add WhatsApp Bulk Messaging Feature Flag

**File:** `/supabase/migrations/20260215000000_whatsapp_feature_flag.sql`

```sql
-- Insert feature flag (if not exists)
INSERT INTO feature_flags (name, description, default_value)
VALUES (
  'whatsapp_bulk_messaging',
  'Enable WhatsApp Bulk Messaging and Campaign Management',
  false
)
ON CONFLICT (name) DO NOTHING;
```

**Run Migration:**
```bash
npx supabase db push
```

#### 3. Create Admin UI for Feature Control

**File:** `/app/admin/tenants/[id]/features/page.tsx`

```typescript
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/browser-client';

export default function TenantFeaturesPage({ params }: { params: { id: string } }) {
  const [features, setFeatures] = useState<any[]>([]);
  const supabase = createClient();

  useEffect(() => {
    loadFeatures();
  }, []);

  async function loadFeatures() {
    // Get all feature flags
    const { data: flags } = await supabase
      .from('feature_flags')
      .select('*')
      .order('name');

    // Get tenant's current toggles
    const { data: toggles } = await supabase
      .from('tenant_feature_toggles')
      .select('*')
      .eq('tenant_id', params.id);

    const toggleMap = new Map(toggles?.map(t => [t.feature_flag_id, t.is_enabled]));

    setFeatures(flags?.map(flag => ({
      ...flag,
      isEnabled: toggleMap.get(flag.id) ?? flag.default_value,
    })) || []);
  }

  async function toggleFeature(featureId: string, enabled: boolean) {
    const { error } = await supabase
      .from('tenant_feature_toggles')
      .upsert({
        tenant_id: params.id,
        feature_flag_id: featureId,
        is_enabled: enabled,
      });

    if (!error) {
      loadFeatures();
    }
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Tenant Feature Flags</h1>

      <div className="space-y-4">
        {features.map(feature => (
          <div key={feature.id} className="flex items-center justify-between p-4 border rounded">
            <div>
              <h3 className="font-semibold">{feature.name}</h3>
              <p className="text-sm text-gray-600">{feature.description}</p>
            </div>
            <button
              onClick={() => toggleFeature(feature.id, !feature.isEnabled)}
              className={`px-4 py-2 rounded ${
                feature.isEnabled
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-300 text-gray-700'
              }`}
            >
              {feature.isEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### 4. Create Helper Function for Feature Checks

**File:** `/lib/features.ts`

```typescript
import { createClient } from '@/lib/supabase/server';

/**
 * Check if a feature is enabled for a tenant
 */
export async function isFeatureEnabled(
  tenantId: string,
  featureName: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc('is_feature_enabled', {
      tenant_id: tenantId,
      feature_name: featureName,
    });

  if (error) {
    console.error('Feature check error:', error);
    return false;
  }

  return data;
}

/**
 * Require feature to be enabled, throw if not
 */
export async function requireFeature(
  tenantId: string,
  featureName: string
): Promise<void> {
  const enabled = await isFeatureEnabled(tenantId, featureName);

  if (!enabled) {
    throw new Error(`Feature "${featureName}" is not enabled for this tenant`);
  }
}
```

#### 5. Create API Middleware

**File:** `/lib/whatsapp/middleware.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { isFeatureEnabled } from '@/lib/features';

/**
 * Middleware to check WhatsApp bulk messaging feature access
 */
export async function requireWhatsAppBulkFeature(
  tenantId: string
): Promise<NextResponse | null> {
  const enabled = await isFeatureEnabled(tenantId, 'whatsapp_bulk_messaging');

  if (!enabled) {
    return NextResponse.json(
      {
        error: 'WhatsApp Bulk Messaging is not enabled for this tenant',
        code: 'FEATURE_NOT_ENABLED',
      },
      { status: 403 }
    );
  }

  return null; // Access allowed
}
```

#### 6. Environment Setup

**Note:** Meta WhatsApp Business setup has been moved to a separate guide.
See [`meta-whatsapp-setup-guide.md`](./meta-whatsapp-setup-guide.md) for detailed instructions.

**Update `.env.local`:**
```bash
# Existing
NEXT_PUBLIC_SUPABASE_URL=your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# New - Encryption
ENCRYPTION_KEY=<generate-with-openssl-rand-hex-32>

# New - Cron Security
CRON_SECRET=<generate-with-openssl-rand-hex-32>
```

**Generate Keys:**
```bash
# Encryption key
openssl rand -hex 32

# Cron secret
openssl rand -hex 32
```

### Deliverables
- [ ] Feature flag `whatsapp_bulk_messaging` created
- [ ] Admin UI for enabling/disabling feature per tenant
- [ ] Helper functions for feature checks
- [ ] API middleware for access control
- [ ] Environment variables configured
2. Create a Business Account (if not exists)
3. Add WhatsApp product
4. Get Phone Number ID and Access Token
5. Configure webhook URL (will set up in Phase 4)

**Credentials Needed:**
```bash
WHATSAPP_PHONE_NUMBER_ID=<from Meta>
WHATSAPP_BUSINESS_ACCOUNT_ID=<from Meta>
WHATSAPP_ACCESS_TOKEN=<from Meta>
VERIFY_TOKEN=<generate random hex>
```

**Generate Verify Token:**
```bash
openssl rand -hex 32
```

#### 2. Environment Setup

**Update `.env.local`:**
```bash
# Existing
NEXT_PUBLIC_SUPABASE_URL=your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# New - WhatsApp Business
WHATSAPP_PHONE_NUMBER_ID=123456789
WHATSAPP_BUSINESS_ACCOUNT_ID=987654321
WHATSAPP_ACCESS_TOKEN=EAAG...
VERIFY_TOKEN=<random-hex-32>

# New - Encryption
ENCRYPTION_KEY=<generate-with-openssl-rand-hex-32>

# New - Cron Security
CRON_SECRET=<generate-with-openssl-rand-hex-32>
```

**Generate Encryption Key:**
```bash
openssl rand -hex 32
```

#### 3. Install Dependencies

```bash
npm install crypto-js csv-parse papaparse
npm install --save-dev @types/crypto-js
```

**Verify Installation:**
```bash
npm run dev
# Should start without errors
```

### Deliverables
- [ ] Meta WhatsApp Business account created
- [ ] All environment variables configured
- [ ] Dependencies installed
- [ ] Development server running

---

## Phase 1: Business Account Integration (Week 1-2)

### Goals
- Allow tenants to connect their WhatsApp Business accounts
- Store encrypted access tokens
- Verify accounts with Meta API

### Database Migration

**File:** `/supabase/migrations/20260215000000_whatsapp_business_accounts.sql`

```sql
-- Table: Tenant WhatsApp Business Accounts
CREATE TABLE tenant_whatsapp_business_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- WhatsApp Business API credentials
  phone_number_id TEXT NOT NULL,
  business_account_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- Encrypted
  phone_number TEXT NOT NULL, -- E.164 format
  phone_number_normalized TEXT NOT NULL, -- Digits only

  -- Account status
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending|verified|suspended|disconnected
  quality_rating TEXT, -- GREEN|YELLOW|RED
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

-- Indexes
CREATE INDEX idx_whatsapp_business_accounts_tenant
  ON tenant_whatsapp_business_accounts(tenant_id, status);

-- RLS Policies
ALTER TABLE tenant_whatsapp_business_accounts ENABLE ROW LEVEL SECURITY;

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

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_whatsapp_business_accounts
  BEFORE UPDATE ON tenant_whatsapp_business_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

**Run Migration:**
```bash
npx supabase db push
```

### Backend Implementation

#### File: `/lib/whatsapp/business-accounts.ts`

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
  messaging_limit?: string;
  display_name?: string;
  created_at: string;
}

/**
 * Encrypt access token before storing
 */
function encryptToken(token: string): string {
  const key = process.env.ENCRYPTION_KEY!;
  if (!key) throw new Error('ENCRYPTION_KEY not set');
  return CryptoJS.AES.encrypt(token, key).toString();
}

/**
 * Decrypt access token for API calls
 */
export function decryptToken(encryptedToken: string): string {
  const key = process.env.ENCRYPTION_KEY!;
  if (!key) throw new Error('ENCRYPTION_KEY not set');
  const bytes = CryptoJS.AES.decrypt(encryptedToken, key);
  return bytes.toString(CryptoJS.enc.Utf8);
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
    throw new Error(`Meta API Error: ${error.error?.message || 'Unknown error'}`);
  }

  return await response.json();
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
      quality_rating: phoneInfo.quality_rating,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('A WhatsApp Business account with this phone number is already connected.');
    }
    throw error;
  }

  return data;
}

/**
 * Sync account status from Meta
 */
export async function syncAccountStatus(accountId: string): Promise<void> {
  const supabase = await createClient();

  const { data: account, error: fetchError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (fetchError) throw fetchError;

  const accessToken = decryptToken(account.access_token);
  const phoneInfo = await verifyPhoneNumberWithMeta(
    account.phone_number_id,
    accessToken
  );

  const { error: updateError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .update({
      quality_rating: phoneInfo.quality_rating,
      status: 'verified',
      verified_at: new Date().toISOString(),
    })
    .eq('id', accountId);

  if (updateError) throw updateError;
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

/**
 * Disconnect account
 */
export async function disconnectBusinessAccount(accountId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .update({
      status: 'disconnected',
    })
    .eq('id', accountId);

  if (error) throw error;
}
```

### API Endpoints

#### File: `/app/api/tenants/[tenantId]/whatsapp/business-accounts/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { connectWhatsAppBusinessAccount, listBusinessAccounts } from '@/lib/whatsapp/business-accounts';
import { getActiveTenantId } from '@/lib/tenant-context';

/**
 * GET - List business accounts
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const accounts = await listBusinessAccounts(params.tenantId);
    return NextResponse.json({ accounts });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - Connect new business account
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const body = await request.json();
    const { phoneNumberId, businessAccountId, accessToken, displayName } = body;

    if (!phoneNumberId || !businessAccountId || !accessToken) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const account = await connectWhatsAppBusinessAccount({
      tenantId: params.tenantId,
      phoneNumberId,
      businessAccountId,
      accessToken,
      displayName,
      userId: 'current-user-id', // Get from auth
    });

    return NextResponse.json({ account }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

#### File: `/app/api/whatsapp/business-accounts/[accountId]/sync/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { syncAccountStatus } from '@/lib/whatsapp/business-accounts';

export async function POST(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    await syncAccountStatus(params.accountId);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

### Testing

**Manual Test:**
```bash
# Test connecting account
curl -X POST http://localhost:3000/api/tenants/TENANT_ID/whatsapp/business-accounts \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumberId": "YOUR_PHONE_ID",
    "businessAccountId": "YOUR_BUSINESS_ID",
    "accessToken": "YOUR_ACCESS_TOKEN",
    "displayName": "Test Business"
  }'

# Expected response:
# {
#   "account": {
#     "id": "uuid",
#     "phone_number": "+1234567890",
#     "status": "pending"
#   }
# }
```

### Deliverables
- [ ] Database migration applied
- [ ] Backend functions implemented
- [ ] API endpoints working
- [ ] Manual test successful
- [ ] Token encryption verified

---

## Phase 2: Template Management (Week 3-4)

### Goals
- Create and submit templates to Meta for approval
- Sync template approval status
- List approved templates

### Database Migration

**File:** `/supabase/migrations/20260215000001_whatsapp_templates.sql`

```sql
CREATE TABLE whatsapp_message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_account_id UUID NOT NULL REFERENCES tenant_whatsapp_business_accounts(id) ON DELETE CASCADE,

  -- Template details
  name TEXT NOT NULL, -- e.g., 'summer_sale_2024'
  language TEXT NOT NULL DEFAULT 'en',
  category TEXT NOT NULL, -- MARKETING|UTILITY|AUTHENTICATION

  -- Template structure
  header_type TEXT, -- text|image|video|document
  header_text TEXT,
  header_media_url TEXT,
  body_text TEXT NOT NULL,
  footer_text TEXT,

  -- Variables (JSONB array)
  variables JSONB DEFAULT '[]'::jsonb,

  -- Buttons (JSONB array)
  buttons JSONB DEFAULT '[]'::jsonb,

  -- Meta approval status
  status TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  meta_template_id TEXT UNIQUE,
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

-- RLS
ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

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

CREATE TRIGGER set_updated_at_whatsapp_templates
  BEFORE UPDATE ON whatsapp_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

### Backend Implementation

#### File: `/lib/whatsapp/templates.ts`

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

  // Header
  if (params.headerType && params.headerText) {
    components.push({
      type: 'HEADER',
      format: params.headerType.toUpperCase(),
      text: params.headerText,
    });
  }

  // Body
  components.push({
    type: 'BODY',
    text: params.bodyText,
  });

  // Footer
  if (params.footerText) {
    components.push({
      type: 'FOOTER',
      text: params.footerText,
    });
  }

  // Buttons
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
    throw new Error(`Meta API Error: ${data.error?.message || 'Unknown error'}`);
  }

  return data.id; // Meta's template ID
}

/**
 * Create template and submit to Meta
 */
export async function createMessageTemplate(
  params: CreateTemplateParams
): Promise<any> {
  const supabase = await createClient();

  // Get business account
  const { data: account, error: accountError } = await supabase
    .from('tenant_whatsapp_business_accounts')
    .select('*')
    .eq('id', params.businessAccountId)
    .single();

  if (accountError) throw accountError;

  // Submit to Meta
  const accessToken = decryptToken(account.access_token);
  const metaTemplateId = await submitTemplateToMeta({
    businessAccountId: account.business_account_id,
    accessToken,
    ...params,
  });

  // Store in database
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
 * Sync template status from Meta
 */
export async function syncTemplateStatus(templateId: string): Promise<void> {
  const supabase = await createClient();

  const { data: template, error: templateError } = await supabase
    .from('whatsapp_message_templates')
    .select('*, tenant_whatsapp_business_accounts(*)')
    .eq('id', templateId)
    .single();

  if (templateError) throw templateError;

  const accessToken = decryptToken(template.tenant_whatsapp_business_accounts.access_token);
  const url = `https://graph.facebook.com/v18.0/${template.meta_template_id}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  await supabase
    .from('whatsapp_message_templates')
    .update({
      status: data.status.toLowerCase(),
      ...(data.status === 'REJECTED' && { rejection_reason: data.rejected_reason }),
    })
    .eq('id', templateId);
}

/**
 * Get approved templates
 */
export async function getApprovedTemplates(
  businessAccountId: string
): Promise<any[]> {
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

### API Endpoints

**File:** `/app/api/whatsapp/business-accounts/[accountId]/templates/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createMessageTemplate, getApprovedTemplates } from '@/lib/whatsapp/templates';

export async function GET(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const templates = await getApprovedTemplates(params.accountId);
    return NextResponse.json({ templates });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { accountId: string } }
) {
  try {
    const body = await request.json();

    const template = await createMessageTemplate({
      businessAccountId: params.accountId,
      ...body,
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
```

### Deliverables
- [ ] Template database schema created
- [ ] Template creation API working
- [ ] Template submission to Meta successful
- [ ] Template sync status working

---

## Phase 3: Contact Management (Week 5-6)

### Goals
- Import contacts from CSV
- Manage contact lists
- Track opt-in/opt-out status

### Database Migration

**File:** `/supabase/migrations/20260215000002_whatsapp_contacts.sql`

```sql
-- Contact Lists
CREATE TABLE whatsapp_contact_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,

  total_contacts INTEGER DEFAULT 0,
  opted_in_count INTEGER DEFAULT 0,

  tags JSONB DEFAULT '[]'::jsonb,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Contacts
CREATE TABLE whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  phone_number TEXT NOT NULL,
  phone_number_normalized TEXT NOT NULL,
  name TEXT,
  email TEXT,

  -- Opt-in (CRITICAL)
  opted_in BOOLEAN DEFAULT false,
  opted_in_at TIMESTAMPTZ,
  opted_out_at TIMESTAMPTZ,
  opt_in_source TEXT, -- web_form|import|conversation|api

  custom_fields JSONB DEFAULT '{}'::jsonb,
  tags JSONB DEFAULT '[]'::jsonb,

  source TEXT, -- import|manual|agent_conversation|api
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(tenant_id, phone_number_normalized)
);

-- Contact List Members (Many-to-Many)
CREATE TABLE whatsapp_contact_list_members (
  contact_id UUID REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  list_id UUID REFERENCES whatsapp_contact_lists(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES auth.users(id),

  PRIMARY KEY (contact_id, list_id)
);

-- Indexes
CREATE INDEX idx_whatsapp_contact_lists_tenant ON whatsapp_contact_lists(tenant_id);
CREATE INDEX idx_whatsapp_contacts_tenant ON whatsapp_contacts(tenant_id, opted_in);
CREATE INDEX idx_whatsapp_contacts_phone ON whatsapp_contacts(phone_number_normalized);
CREATE INDEX idx_contact_list_members_list ON whatsapp_contact_list_members(list_id);

-- RLS
ALTER TABLE whatsapp_contact_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_contact_list_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage contact lists"
  ON whatsapp_contact_lists FOR ALL
  USING (EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_users.user_id = auth.uid()
    AND tenant_users.tenant_id = whatsapp_contact_lists.tenant_id
  ));

CREATE POLICY "Tenant members manage contacts"
  ON whatsapp_contacts FOR ALL
  USING (EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_users.user_id = auth.uid()
    AND tenant_users.tenant_id = whatsapp_contacts.tenant_id
  ));

CREATE POLICY "Tenant members manage members"
  ON whatsapp_contact_list_members FOR ALL
  USING (EXISTS (
    SELECT 1 FROM whatsapp_contact_lists cl
    JOIN tenant_users tu ON tu.tenant_id = cl.tenant_id
    WHERE cl.id = whatsapp_contact_list_members.list_id
    AND tu.user_id = auth.uid()
  ));

-- Triggers
CREATE TRIGGER set_updated_at_contact_lists
  BEFORE UPDATE ON whatsapp_contact_lists
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_contacts
  BEFORE UPDATE ON whatsapp_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Backend Implementation

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
  customFields?: Record<string, any>;
  tags?: string[];
}

function validatePhoneNumber(phoneNumber: string): {
  isValid: boolean;
  normalized: string;
  e164: string;
} {
  const normalized = phoneNumber.replace(/\D/g, '');
  const e164 = phoneNumber.startsWith('+') ? phoneNumber : `+${normalized}`;
  const isValid = /^\+[1-9]\d{7,14}$/.test(e164);

  return { isValid, normalized, e164 };
}

export async function createContact(params: CreateContactParams): Promise<any> {
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
      opt_in_source: 'manual',
      custom_fields: params.customFields || {},
      tags: params.tags || [],
      source: 'manual',
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('Contact already exists');
    }
    throw error;
  }

  return data;
}

export async function importContacts(params: {
  tenantId: string;
  csvContent: string;
  listId?: string;
  autoOptIn?: boolean;
  userId: string;
}): Promise<{ imported: number; errors: string[]; contactIds: string[] }> {
  const supabase = await createClient();

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
      if (!record.phone_number) {
        errors.push(`Row ${i + 1}: Missing phone_number`);
        continue;
      }

      const { isValid, normalized, e164 } = validatePhoneNumber(record.phone_number);

      if (!isValid) {
        errors.push(`Row ${i + 1}: Invalid phone number`);
        continue;
      }

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

      // Add to list
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

  return { imported: contactIds.length, errors, contactIds };
}

export async function createContactList(params: {
  tenantId: string;
  name: string;
  description?: string;
  userId: string;
}): Promise<any> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('whatsapp_contact_lists')
    .insert({
      tenant_id: params.tenantId,
      name: params.name,
      description: params.description,
      created_by: params.userId,
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}
```

### Deliverables
- [ ] Contact tables created
- [ ] CSV import working
- [ ] Contact list creation working
- [ ] Opt-in tracking implemented

---

## Phase 4: Campaign & Queue System (Week 7-8)

### Goals
- Create campaigns
- Populate message queue
- Process queue with cron job
- Handle retries and failures

### Database Migration

**File:** `/supabase/migrations/20260215000003_whatsapp_campaigns.sql`

```sql
-- Campaigns
CREATE TABLE whatsapp_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_account_id UUID NOT NULL REFERENCES tenant_whatsapp_business_accounts(id) ON DELETE CASCADE,

  name TEXT NOT NULL,
  description TEXT,

  template_id UUID REFERENCES whatsapp_message_templates(id) ON DELETE RESTRICT,
  template_variables JSONB DEFAULT '{}'::jsonb,

  contact_list_ids UUID[] NOT NULL,
  filter_criteria JSONB,

  status TEXT NOT NULL DEFAULT 'draft',
  -- draft|scheduled|sending|paused|completed|failed|cancelled
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

  max_messages_per_second INTEGER DEFAULT 20,

  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Message Queue (DATABASE QUEUE - NO REDIS)
CREATE TABLE whatsapp_message_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  campaign_id UUID REFERENCES whatsapp_campaigns(id) ON DELETE CASCADE,
  business_account_id UUID NOT NULL REFERENCES tenant_whatsapp_business_accounts(id) ON DELETE CASCADE,

  contact_id UUID REFERENCES whatsapp_contacts(id) ON DELETE SET NULL,
  to_phone_number TEXT NOT NULL,

  template_id UUID REFERENCES whatsapp_message_templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  template_language TEXT NOT NULL,
  template_variables JSONB DEFAULT '{}'::jsonb,

  -- Queue status
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending|processing|sent|delivered|read|failed|cancelled
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Result tracking
  whatsapp_message_id TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  error_code TEXT,

  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for queue processing
CREATE INDEX idx_whatsapp_campaigns_tenant ON whatsapp_campaigns(tenant_id, status);
CREATE INDEX idx_whatsapp_campaigns_status ON whatsapp_campaigns(status, scheduled_at);
CREATE INDEX idx_whatsapp_queue_pending ON whatsapp_message_queue(status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX idx_whatsapp_queue_campaign ON whatsapp_message_queue(campaign_id, status);

-- RLS
ALTER TABLE whatsapp_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_message_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members manage campaigns"
  ON whatsapp_campaigns FOR ALL
  USING (EXISTS (
    SELECT 1 FROM tenant_users
    WHERE tenant_users.user_id = auth.uid()
    AND tenant_users.tenant_id = whatsapp_campaigns.tenant_id
  ));

-- Service role only for queue processing
CREATE POLICY "Service role manages queue"
  ON whatsapp_message_queue FOR ALL
  USING (auth.role() = 'service_role');

-- Allow tenant members to view their queue items
CREATE POLICY "Tenant members view queue"
  ON whatsapp_message_queue FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM whatsapp_campaigns c
    JOIN tenant_users tu ON tu.tenant_id = c.tenant_id
    WHERE c.id = whatsapp_message_queue.campaign_id
    AND tu.user_id = auth.uid()
  ));

-- Helper functions
CREATE OR REPLACE FUNCTION increment_campaign_sent(p_campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE whatsapp_campaigns
  SET
    messages_sent = messages_sent + 1,
    messages_pending = GREATEST(messages_pending - 1, 0),
    updated_at = NOW()
  WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_campaign_failed(p_campaign_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE whatsapp_campaigns
  SET
    messages_failed = messages_failed + 1,
    messages_pending = GREATEST(messages_pending - 1, 0),
    updated_at = NOW()
  WHERE id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- Auto-complete campaign when queue is done
CREATE OR REPLACE FUNCTION check_campaign_completion()
RETURNS TRIGGER AS $$
BEGIN
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

CREATE TRIGGER trigger_check_campaign_completion
AFTER UPDATE OF status ON whatsapp_message_queue
FOR EACH ROW
WHEN (NEW.status IN ('sent', 'failed'))
EXECUTE FUNCTION check_campaign_completion();

-- Triggers
CREATE TRIGGER set_updated_at_campaigns
  BEFORE UPDATE ON whatsapp_campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER set_updated_at_queue
  BEFORE UPDATE ON whatsapp_message_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Backend Implementation

#### File: `/lib/whatsapp/campaigns.ts`

```typescript
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service-client';

interface CreateCampaignParams {
  tenantId: string;
  businessAccountId: string;
  name: string;
  description?: string;
  templateId: string;
  templateVariables?: Record<string, string>;
  contactListIds: string[];
  scheduledAt?: Date;
  maxMessagesPerSecond?: number;
  userId: string;
}

export async function createCampaign(params: CreateCampaignParams): Promise<any> {
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

export async function startCampaign(campaignId: string): Promise<void> {
  const supabase = createServiceClient();

  // Get campaign
  const { data: campaign, error: campaignError } = await supabase
    .from('whatsapp_campaigns')
    .select(`
      *,
      whatsapp_message_templates(*)
    `)
    .eq('id', campaignId)
    .single();

  if (campaignError) throw campaignError;

  // Get contacts from lists
  const { data: members, error: membersError } = await supabase
    .from('whatsapp_contact_list_members')
    .select('whatsapp_contacts(*)')
    .in('list_id', campaign.contact_list_ids);

  if (membersError) throw membersError;

  const contacts = members
    .map(m => m.whatsapp_contacts)
    .filter(c => c.opted_in);

  if (contacts.length === 0) {
    throw new Error('No opted-in contacts found');
  }

  // Update campaign
  await supabase
    .from('whatsapp_campaigns')
    .update({
      status: 'sending',
      started_at: new Date().toISOString(),
      total_recipients: contacts.length,
      messages_pending: contacts.length,
    })
    .eq('id', campaignId);

  // Queue all messages
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
      customer_name: contact.name || 'Customer',
      ...contact.custom_fields,
    },
    status: 'pending',
    max_attempts: 3,
  }));

  // Insert in batches
  const batchSize = 1000;
  for (let i = 0; i < queueItems.length; i += batchSize) {
    const batch = queueItems.slice(i, i + batchSize);
    await supabase.from('whatsapp_message_queue').insert(batch);
  }
}
```

#### File: `/lib/whatsapp/queue-processor.ts`

```typescript
import { createServiceClient } from '@/lib/supabase/service-client';
import { decryptToken } from './business-accounts';
import { sendTemplateMessage } from './template-sender';

/**
 * Process pending messages from database queue
 * Called by cron job every 30 seconds
 */
export async function processMessageQueue(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const supabase = createServiceClient();

  // Fetch pending messages
  const { data: messages, error } = await supabase
    .from('whatsapp_message_queue')
    .select(`
      *,
      tenant_whatsapp_business_accounts(*)
    `)
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('created_at')
    .limit(20); // Process 20 at a time (rate limiting)

  if (error || !messages || messages.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  // Process each message
  const promises = messages.map(async (message) => {
    try {
      // Mark as processing
      const { error: updateError } = await supabase
        .from('whatsapp_message_queue')
        .update({
          status: 'processing',
          attempts: message.attempts + 1,
        })
        .eq('id', message.id)
        .eq('status', 'pending'); // Only update if still pending

      if (updateError) return; // Another worker got it

      // Decrypt token
      const accessToken = decryptToken(
        message.tenant_whatsapp_business_accounts.access_token
      );

      // Send message
      const result = await sendTemplateMessage({
        phoneNumberId: message.tenant_whatsapp_business_accounts.phone_number_id,
        accessToken,
        to: message.to_phone_number,
        templateName: message.template_name,
        language: message.template_language,
        variables: message.template_variables,
      });

      // Mark as sent
      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: 'sent',
          whatsapp_message_id: result.messageId,
          sent_at: new Date().toISOString(),
          processed_at: new Date().toISOString(),
        })
        .eq('id', message.id);

      // Update campaign stats
      await supabase.rpc('increment_campaign_sent', {
        p_campaign_id: message.campaign_id,
      });

      succeeded++;
    } catch (error: any) {
      const isLastAttempt = message.attempts + 1 >= message.max_attempts;

      await supabase
        .from('whatsapp_message_queue')
        .update({
          status: isLastAttempt ? 'failed' : 'pending',
          failed_at: isLastAttempt ? new Date().toISOString() : null,
          error_message: error.message,
          error_code: error.code || 'UNKNOWN',
          // Exponential backoff
          scheduled_for: isLastAttempt
            ? null
            : new Date(Date.now() + Math.pow(2, message.attempts) * 1000).toISOString(),
          processed_at: new Date().toISOString(),
        })
        .eq('id', message.id);

      if (isLastAttempt) {
        await supabase.rpc('increment_campaign_failed', {
          p_campaign_id: message.campaign_id,
        });
      }

      failed++;
    }
  });

  await Promise.all(promises);

  return {
    processed: messages.length,
    succeeded,
    failed,
  };
}
```

#### File: `/lib/whatsapp/template-sender.ts`

```typescript
interface SendTemplateMessageParams {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  templateName: string;
  language: string;
  variables?: Record<string, string>;
}

export class WhatsAppAPIError extends Error {
  code: number;

  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

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

  // Add variables if provided
  if (params.variables && Object.keys(params.variables).length > 0) {
    payload.template.components = [
      {
        type: 'body',
        parameters: Object.values(params.variables).map(value => ({
          type: 'text',
          text: value,
        })),
      },
    ];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    throw new WhatsAppAPIError(
      data.error?.message || 'Unknown error',
      data.error?.code || 500
    );
  }

  return { messageId: data.messages[0].id };
}
```

### Cron Job Setup

#### File: `/app/api/cron/process-whatsapp-queue/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { processMessageQueue } from '@/lib/whatsapp/queue-processor';

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const result = await processMessageQueue();

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Queue processing error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
```

#### File: `vercel.json`

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

### Deliverables
- [ ] Campaign tables created
- [ ] Queue system implemented
- [ ] Cron job configured
- [ ] Message sending working
- [ ] Retry logic tested

---

## Phase 5: UI & Testing (Week 9-10)

### Goals
- Build admin dashboard
- Campaign creation wizard
- Real-time campaign monitoring
- End-to-end testing

### UI Components

#### Dashboard Pages Structure

```
/dashboard/whatsapp/
├── business-accounts     # Connect WhatsApp accounts
├── templates            # Create & manage templates
├── contacts             # Import & manage contacts
├── campaigns            # Create & monitor campaigns
└── analytics            # Campaign performance
```

### Testing Strategy

See [Testing Strategy](#testing-strategy) section below.

### Deliverables
- [ ] All dashboard pages built
- [ ] Campaign wizard working
- [ ] Real-time stats updating
- [ ] End-to-end tests passing

---

## Phase 6: Compliance & Production (Week 11-12)

### Goals
- Opt-in/opt-out flows
- GDPR compliance
- Production deployment
- Monitoring & alerts

### Compliance Checklist

- [ ] Opt-in collection documented
- [ ] Opt-out instructions in templates
- [ ] Data export API implemented
- [ ] Data deletion API implemented
- [ ] Consent timestamps stored
- [ ] Privacy policy updated

### Production Checklist

See [Deployment Checklist](#deployment-checklist) section below.

### Deliverables
- [ ] Compliance requirements met
- [ ] Production deployment successful
- [ ] Monitoring configured
- [ ] Documentation complete

---

## Testing Strategy

### Unit Tests

```typescript
// /lib/whatsapp/__tests__/contacts.test.ts
import { validatePhoneNumber } from '../contacts';

describe('Contact Management', () => {
  test('validates E.164 phone numbers', () => {
    const result = validatePhoneNumber('+1234567890');
    expect(result.isValid).toBe(true);
    expect(result.e164).toBe('+1234567890');
    expect(result.normalized).toBe('1234567890');
  });

  test('rejects invalid phone numbers', () => {
    const result = validatePhoneNumber('invalid');
    expect(result.isValid).toBe(false);
  });
});
```

### Integration Tests

```typescript
// /lib/whatsapp/__tests__/campaign.integration.test.ts
describe('Campaign Flow', () => {
  test('creates campaign and queues messages', async () => {
    // 1. Create campaign
    const campaign = await createCampaign({
      tenantId: 'test-tenant',
      businessAccountId: 'test-account',
      name: 'Test Campaign',
      templateId: 'test-template',
      contactListIds: ['test-list'],
      userId: 'test-user',
    });

    expect(campaign.id).toBeDefined();
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

**Phase 1: Business Accounts**
- [ ] Connect WhatsApp Business account
- [ ] Sync account status from Meta
- [ ] Verify token encryption
- [ ] Disconnect account

**Phase 2: Templates**
- [ ] Create template with variables
- [ ] Submit to Meta
- [ ] Sync approval status
- [ ] List approved templates

**Phase 3: Contacts**
- [ ] Import contacts from CSV
- [ ] Create contact list
- [ ] Add contacts to list
- [ ] Toggle opt-in status

**Phase 4: Campaigns**
- [ ] Create campaign
- [ ] Start campaign
- [ ] Verify queue population
- [ ] Process queue via cron
- [ ] Check message sent status
- [ ] Verify retry on failure

**Phase 5: UI**
- [ ] Navigate all dashboard pages
- [ ] Create campaign via wizard
- [ ] Monitor real-time stats
- [ ] View campaign analytics

---

## Deployment Checklist

### Pre-Deployment

- [ ] All environment variables set in production
- [ ] Database migrations applied
- [ ] RLS policies tested
- [ ] Encryption keys rotated
- [ ] Vercel cron job configured
- [ ] Webhook URL registered with Meta

### Production Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# WhatsApp
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_BUSINESS_ACCOUNT_ID=
WHATSAPP_ACCESS_TOKEN=
VERIFY_TOKEN=

# Security
ENCRYPTION_KEY=
CRON_SECRET=

# App
NEXT_PUBLIC_APP_URL=https://yourapp.com
```

### Post-Deployment

- [ ] Test cron job execution
- [ ] Verify webhook receiving messages
- [ ] Monitor queue processing logs
- [ ] Set up error alerts (Sentry/Datadog)
- [ ] Test full campaign flow in production
- [ ] Load test with 1000+ messages

### Monitoring

**Key Metrics to Track:**

1. **Queue Performance**
   - Messages processed per minute
   - Average processing time
   - Failed message rate

2. **Campaign Metrics**
   - Delivery rate (% delivered)
   - Read rate (% read)
   - Failure rate

3. **API Health**
   - Meta API response times
   - Error rates by error code
   - Rate limit warnings

**Recommended Tools:**
- Vercel Analytics (included)
- Sentry (error tracking)
- Supabase Logs (database queries)

---

## Cost Breakdown

### Development Phase (12 weeks)

| Phase | Duration | Estimated Effort |
|-------|----------|------------------|
| Phase 1 | 2 weeks | 40 hours |
| Phase 2 | 2 weeks | 40 hours |
| Phase 3 | 2 weeks | 40 hours |
| Phase 4 | 2 weeks | 50 hours |
| Phase 5 | 2 weeks | 50 hours |
| Phase 6 | 2 weeks | 30 hours |
| **Total** | **12 weeks** | **250 hours** |

### Monthly Operating Costs

| Component | Cost |
|-----------|------|
| Supabase (Pro) | $25/month |
| Vercel (Pro) | $20/month |
| WhatsApp API (10K msgs) | ~$100-140/month |
| **Total** | **$145-185/month** |

---

## Success Criteria

### Phase 1-3 Complete
- [ ] Tenants can connect WhatsApp Business accounts
- [ ] Templates can be created and approved
- [ ] Contacts can be imported and organized

### Phase 4 Complete
- [ ] Campaigns queue messages successfully
- [ ] Cron job processes 20 messages every 30 seconds
- [ ] Failed messages retry with backoff
- [ ] Campaign auto-completes when queue is empty

### Phase 5-6 Complete
- [ ] Full UI for campaign creation
- [ ] Real-time campaign monitoring
- [ ] GDPR-compliant opt-in/opt-out
- [ ] Production deployment successful

### Performance Targets
- [ ] Process 1000 messages in ~25 minutes (20 msg/30sec)
- [ ] 95%+ delivery rate
- [ ] <5% message failure rate
- [ ] Zero data breaches

---

## Next Steps

1. **Review Plan:** Approve architecture and timeline
2. **Set Up Meta:** Complete WhatsApp Business account setup
3. **Configure Environment:** Add all required environment variables
4. **Start Phase 1:** Begin database migrations and backend implementation

---

**Document Version:** 1.0
**Created:** 2024-02-15
**Architecture:** Database Queue (No Redis)
**Estimated Timeline:** 12 weeks
**Estimated Effort:** 250 hours
