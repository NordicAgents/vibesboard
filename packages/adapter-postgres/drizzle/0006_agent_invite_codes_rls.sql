-- Enable RLS + tenant-isolation policy for agent_invite_codes.
-- This table was added in 0005_jazzy_electro (PR 2d) but missed its RLS
-- policy; it is tenant-scoped (has tenant_id), so it uses the standard
-- tenant isolation pattern (see 0001_rls_policies). The invite-code helpers
-- run via the BYPASSRLS migrate client, so this does not change their behavior;
-- it closes the tenant-isolation gap for any RLS-scoped access.

ALTER TABLE agent_invite_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY agent_invite_codes_iso ON agent_invite_codes
  USING (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
