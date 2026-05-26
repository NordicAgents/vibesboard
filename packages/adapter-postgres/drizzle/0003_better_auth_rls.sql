-- Enable RLS on the new Better Auth tables.
-- `accounts` is keyed on user_id (matches the existing sessions_self pattern).
-- `verifications` is INTENTIONALLY NOT RLS-protected: the auth flow inserts
-- a row keyed by `identifier` (the email being verified) BEFORE the user
-- exists. Adding it to the RLS_EXEMPT allowlist in rls-coverage.test.ts.

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY accounts_self ON accounts
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR current_setting('app.is_super_admin', true) = 'true'
  );
