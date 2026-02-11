-- Fix WhatsApp phone number reuse constraint
-- Allow phone numbers to be reused after disconnection
-- Only enforce uniqueness for active/pending connections

-- Drop the old UNIQUE constraint
ALTER TABLE whatsapp_agent_connections
  DROP CONSTRAINT IF EXISTS whatsapp_agent_connections_agent_id_phone_number_normalized_key;

-- Create a partial UNIQUE index that only applies to active and pending connections
-- This allows the same phone number to be reused after disconnection
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_unique_active_phone
  ON whatsapp_agent_connections(agent_id, phone_number_normalized)
  WHERE status IN ('active', 'pending');

COMMENT ON INDEX idx_whatsapp_unique_active_phone IS
  'Ensures one phone number can only have one active or pending connection per agent. Allows reuse after disconnection.';
