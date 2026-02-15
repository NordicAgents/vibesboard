-- =====================================================
-- WhatsApp Bulk Messaging Feature - Database Migration
-- =====================================================
-- This migration adds the WhatsApp bulk messaging feature flag
-- and prepares the system for tenant-specific WhatsApp Business accounts
--
-- Dependencies:
--   - 20251122000000_multi_tenant_system.sql (Multi-tenant foundation)
--   - 20260209000000_whatsapp_agent_connections.sql (WhatsApp 1:1 messaging)
--
-- Feature: whatsapp_bulk_messaging
-- - Super Admin can enable per tenant
-- - Each tenant connects their own Meta WhatsApp Business Account
-- - Supports template-based marketing campaigns with queue processing
-- =====================================================

-- =====================================================
-- 1. Add WhatsApp Bulk Messaging Feature Flag
-- =====================================================

-- Insert the feature flag if it doesn't exist
INSERT INTO feature_flags (name, description, default_value)
VALUES (
  'whatsapp_bulk_messaging',
  'Enable WhatsApp Bulk Messaging and Campaign Management',
  false
)
ON CONFLICT (name) DO NOTHING;

-- =====================================================
-- 2. Tenant WhatsApp Business Accounts
-- =====================================================

CREATE TABLE IF NOT EXISTS tenant_whatsapp_business_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- WhatsApp Business API credentials
  phone_number_id TEXT NOT NULL,
  business_account_id TEXT NOT NULL,
  access_token TEXT NOT NULL, -- Encrypted
  phone_number TEXT NOT NULL, -- E.164 format (+1234567890)
  phone_number_normalized TEXT NOT NULL, -- Digits only (1234567890)

  -- Account status
  status TEXT NOT NULL DEFAULT 'pending',
  -- Status values: pending|verified|suspended|disconnected
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

  -- Each tenant can only have one active account per phone number
  UNIQUE(tenant_id, phone_number_normalized)
);

-- Indexes
CREATE INDEX idx_whatsapp_business_accounts_tenant
  ON tenant_whatsapp_business_accounts(tenant_id, status);

-- RLS Policies
ALTER TABLE tenant_whatsapp_business_accounts ENABLE ROW LEVEL SECURITY;

-- Policy: Tenant members can view and manage their business accounts
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

-- =====================================================
-- 3. WhatsApp Message Templates
-- =====================================================

CREATE TABLE IF NOT EXISTS whatsapp_message_templates (
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

  -- Variables (JSONB array)
  -- Example: ["customer_name", "discount_amount", "expiry_date"]
  variables JSONB DEFAULT '[]'::jsonb,

  -- Buttons (JSONB array)
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

  -- Each business account can only have one template with same name and language
  UNIQUE(business_account_id, name, language)
);

-- Indexes
CREATE INDEX idx_whatsapp_templates_account
  ON whatsapp_message_templates(business_account_id, status);

-- RLS Policies
ALTER TABLE whatsapp_message_templates ENABLE ROW LEVEL SECURITY;

-- Policy: Tenant members can manage templates via their business account
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

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_whatsapp_templates
  BEFORE UPDATE ON whatsapp_message_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 4. Contact Lists
-- =====================================================

CREATE TABLE IF NOT EXISTS whatsapp_contact_lists (
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

-- Indexes
CREATE INDEX idx_whatsapp_contact_lists_tenant
  ON whatsapp_contact_lists(tenant_id);

-- RLS Policies
ALTER TABLE whatsapp_contact_lists ENABLE ROW LEVEL SECURITY;

-- Policy: Tenant members can manage contact lists
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

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_contact_lists
  BEFORE UPDATE ON whatsapp_contact_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 5. Contacts
-- =====================================================

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
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

  -- Each tenant can only have one contact per phone number
  UNIQUE(tenant_id, phone_number_normalized)
);

-- Indexes
CREATE INDEX idx_whatsapp_contacts_tenant ON whatsapp_contacts(tenant_id, opted_in);
CREATE INDEX idx_whatsapp_contacts_phone ON whatsapp_contacts(phone_number_normalized);

-- RLS Policies
ALTER TABLE whatsapp_contacts ENABLE ROW LEVEL SECURITY;

-- Policy: Tenant members can manage contacts
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

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_contacts
  BEFORE UPDATE ON whatsapp_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 6. Contact List Membership
-- =====================================================

CREATE TABLE IF NOT EXISTS whatsapp_contact_list_members (
  contact_id UUID REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
  list_id UUID REFERENCES whatsapp_contact_lists(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ DEFAULT NOW(),
  added_by UUID REFERENCES auth.users(id),

  PRIMARY KEY (contact_id, list_id)
);

-- Indexes
CREATE INDEX idx_contact_list_members_list ON whatsapp_contact_list_members(list_id);

-- RLS Policies
ALTER TABLE whatsapp_contact_list_members ENABLE ROW LEVEL SECURITY;

-- Policy: Tenant members can manage list members
CREATE POLICY "Tenant members can manage members"
  ON whatsapp_contact_list_members
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM whatsapp_contact_lists cl
      JOIN tenant_users tu ON tu.tenant_id = cl.tenant_id
      WHERE cl.id = whatsapp_contact_list_members.list_id
      AND tu.user_id = auth.uid()
    )
  );

-- =====================================================
-- 7. Campaigns
-- =====================================================

CREATE TABLE IF NOT EXISTS whatsapp_campaigns (
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

-- Indexes
CREATE INDEX idx_whatsapp_campaigns_tenant ON whatsapp_campaigns(tenant_id, status);
CREATE INDEX idx_whatsapp_campaigns_status ON whatsapp_campaigns(status, scheduled_at);

-- RLS Policies
ALTER TABLE whatsapp_campaigns ENABLE ROW LEVEL SECURITY;

-- Policy: Tenant members can manage campaigns
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

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_campaigns
  BEFORE UPDATE ON whatsapp_campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 8. Message Queue (Database Queue - No Redis)
-- =====================================================

CREATE TABLE IF NOT EXISTS whatsapp_message_queue (
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

-- Indexes for queue processing
CREATE INDEX idx_whatsapp_queue_pending ON whatsapp_message_queue(status, scheduled_for)
  WHERE status = 'pending';
CREATE INDEX idx_whatsapp_queue_campaign ON whatsapp_message_queue(campaign_id, status);

-- RLS Policies
ALTER TABLE whatsapp_message_queue ENABLE ROW LEVEL SECURITY;

-- Policy: Service role can manage queue (background workers)
CREATE POLICY "Service role can manage queue"
  ON whatsapp_message_queue
  FOR ALL
  USING (auth.role() = 'service_role');

-- Policy: Tenant members can view their queue items
CREATE POLICY "Tenant members can view queue"
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

-- Trigger for updated_at
CREATE TRIGGER set_updated_at_queue
  BEFORE UPDATE ON whatsapp_message_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- 9. Database Helper Functions
-- =====================================================

-- Function: Increment campaign sent count
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Increment campaign failed count
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Auto-complete campaign when queue is done
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger: Check campaign completion on queue status change
CREATE TRIGGER trigger_check_campaign_completion
AFTER UPDATE OF status ON whatsapp_message_queue
FOR EACH ROW
WHEN (NEW.status IN ('sent', 'failed'))
EXECUTE FUNCTION check_campaign_completion();

-- =====================================================
-- 10. Comments for Documentation
-- =====================================================

COMMENT ON TABLE tenant_whatsapp_business_accounts IS 'Stores WhatsApp Business account credentials per tenant';
COMMENT ON COLUMN tenant_whatsapp_business_accounts.access_token IS 'Encrypted using ENCRYPTION_KEY environment variable';
COMMENT ON COLUMN tenant_whatsapp_business_accounts.quality_rating IS 'Meta quality rating: GREEN (good), YELLOW (warning), RED (suspended)';
COMMENT ON COLUMN tenant_whatsapp_business_accounts.messaging_limit IS 'Daily message limit tier from Meta';

COMMENT ON TABLE whatsapp_message_templates IS 'WhatsApp message templates approved by Meta for marketing/utility messages';
COMMENT ON COLUMN whatsapp_message_templates.variables IS 'Array of variable names used in template body (e.g., ["customer_name", "discount"])';
COMMENT ON COLUMN whatsapp_message_templates.meta_template_id IS 'Meta-assigned template ID after approval';

COMMENT ON TABLE whatsapp_contacts IS 'Contact database with opt-in tracking for GDPR compliance';
COMMENT ON COLUMN whatsapp_contacts.opted_in IS 'CRITICAL: Must be true before sending marketing messages';
COMMENT ON COLUMN whatsapp_contacts.custom_fields IS 'Custom data for personalization (e.g., {"tier": "gold"})';

COMMENT ON TABLE whatsapp_campaigns IS 'Bulk messaging campaigns with scheduling and analytics';
COMMENT ON COLUMN whatsapp_campaigns.contact_list_ids IS 'Array of list IDs to target';
COMMENT ON COLUMN whatsapp_campaigns.max_messages_per_second IS 'Rate limit (default 20 msg/sec)';

COMMENT ON TABLE whatsapp_message_queue IS 'Database queue for async message processing (no Redis needed)';
COMMENT ON COLUMN whatsapp_message_queue.status IS 'Workflow: pending → processing → sent → delivered → read (or failed)';
COMMENT ON COLUMN whatsapp_message_queue.attempts IS 'Retry counter (max 3 by default)';

COMMENT ON FUNCTION increment_campaign_sent IS 'Atomically increment sent counter and decrement pending';
COMMENT ON FUNCTION check_campaign_completion IS 'Auto-mark campaign as completed when all messages processed';
