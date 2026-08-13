-- Explicit policies for the hybrid memory tables created in 0020.
--
-- 0020 enabled RLS with no policies (deny-all for the app role — scope_id
-- holds an agent id, so the standard tenant-GUC policies can't apply; all
-- access goes through the BYPASSRLS migrate client). That is the intended
-- posture, but the rls-coverage guard test requires every table to carry at
-- least one policy. These super-admin-only policies keep the app role denied
-- in normal sessions while making the deny-all posture explicit and allowing
-- super-admin GUC sessions (the same escape hatch every other policy has).
CREATE POLICY "hybrid_memories_super_admin" ON "hybrid_memories"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
--> statement-breakpoint
CREATE POLICY "hybrid_observations_super_admin" ON "hybrid_observations"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
--> statement-breakpoint
CREATE POLICY "hybrid_message_embeddings_super_admin" ON "hybrid_message_embeddings"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
--> statement-breakpoint
CREATE POLICY "hybrid_processed_conversations_super_admin" ON "hybrid_processed_conversations"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
--> statement-breakpoint
CREATE POLICY "hybrid_mutations_super_admin" ON "hybrid_mutations"
  USING (current_setting('app.is_super_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_super_admin', true) = 'true');
