-- Enable RLS and apply isolation policies for every multi-tenant table.
-- Generated from packages/adapter-postgres/src/schema. If you add a new
-- multi-tenant table, add an `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and
-- a matching policy here, and update RLS_EXEMPT in rls-coverage.test.ts.

-- ─── tenants & members ─────────────────────────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_iso ON tenants
  USING (
    id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );

ALTER TABLE tenant_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_members_iso ON tenant_members
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitations_iso ON invitations
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- ─── users & sessions (keyed on user, not tenant) ─────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_self ON users
  USING (
    id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sessions_self ON sessions
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );

-- ─── agent-tree tables ────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'agents',
      'agent_links',
      'hooks',
      'hook_jobs',
      'conversations',
      'messages',
      'conversation_feedback',
      'notifications',
      'files',
      'embeddings',
      'calendar_connections',
      'bookings',
      'booking_enquiries',
      'whatsapp_inbox_accounts',
      'whatsapp_inbox_conversations',
      'whatsapp_inbox_messages',
      'instagram_inbox_accounts',
      'instagram_inbox_conversations',
      'instagram_inbox_messages',
      'chatwoot_connections',
      'tenant_feature_toggles',
      'usage_counters',
      'data_connections',
      'data_action_logs',
      'tenant_branding'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY %I ON %I
        USING (
          tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          OR current_setting('app.is_super_admin', true) = 'true'
        )
        WITH CHECK (
          tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          OR current_setting('app.is_super_admin', true) = 'true'
        )
    $p$, t || '_iso', t);
  END LOOP;
END $$;

-- ─── globally-readable tables ─────────────────────────────────────────
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_read ON feature_flags
  FOR SELECT
  USING (NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
         OR current_setting('app.is_super_admin', true) = 'true');
CREATE POLICY feature_flags_write ON feature_flags
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');

ALTER TABLE platform_branding ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_branding_read ON platform_branding
  FOR SELECT
  USING (true);
CREATE POLICY platform_branding_write ON platform_branding
  FOR ALL
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
