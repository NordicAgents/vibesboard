-- WhatsApp Agent Connections
-- Manages phone number to agent mappings for WhatsApp integration

-- Create whatsapp_agent_connections table
CREATE TABLE whatsapp_agent_connections (
  -- Primary identification
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  agent_id UUID NOT NULL REFERENCES vibe_agents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id), -- Connection creator

  -- WhatsApp details
  phone_number TEXT NOT NULL, -- E.164 format: +919400293288
  phone_number_normalized TEXT NOT NULL, -- Searchable: 919400293288

  -- Connection status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disconnected', 'expired')),

  -- Introduction message
  custom_intro_message TEXT,
  intro_message_sent_at TIMESTAMPTZ,
  intro_message_id TEXT, -- WhatsApp message ID

  -- Activity tracking
  last_message_received_at TIMESTAMPTZ,
  total_conversations INTEGER DEFAULT 0,

  -- Lifecycle
  connected_at TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ, -- Optional: auto-expire connections
  disconnection_reason TEXT,

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(agent_id, phone_number_normalized), -- One agent per phone
  CHECK (
    (status = 'active' AND connected_at IS NOT NULL) OR
    (status = 'disconnected' AND disconnected_at IS NOT NULL) OR
    (status = 'expired' AND expires_at <= NOW()) OR
    (status = 'pending')
  )
);

-- Indexes for performance
CREATE INDEX idx_whatsapp_connections_agent
  ON whatsapp_agent_connections(agent_id, status);

CREATE INDEX idx_whatsapp_connections_phone
  ON whatsapp_agent_connections(phone_number_normalized, status);

CREATE INDEX idx_whatsapp_connections_active
  ON whatsapp_agent_connections(status, agent_id)
  WHERE status = 'active';

CREATE INDEX idx_whatsapp_connections_user
  ON whatsapp_agent_connections(user_id, created_at DESC);

-- Updated at trigger
CREATE TRIGGER update_whatsapp_agent_connections_updated_at
  BEFORE UPDATE ON whatsapp_agent_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS)
ALTER TABLE whatsapp_agent_connections ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view connections for their own agents
CREATE POLICY whatsapp_connections_select_own_agents
  ON whatsapp_agent_connections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM vibe_agents
      WHERE vibe_agents.id = whatsapp_agent_connections.agent_id
        AND vibe_agents.user_id = auth.uid()
    )
  );

-- Policy: Users can create connections for their own agents
CREATE POLICY whatsapp_connections_insert_own_agents
  ON whatsapp_agent_connections
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM vibe_agents
      WHERE vibe_agents.id = whatsapp_agent_connections.agent_id
        AND vibe_agents.user_id = auth.uid()
    )
  );

-- Policy: Users can update connections for their own agents
CREATE POLICY whatsapp_connections_update_own_agents
  ON whatsapp_agent_connections
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM vibe_agents
      WHERE vibe_agents.id = whatsapp_agent_connections.agent_id
        AND vibe_agents.user_id = auth.uid()
    )
  );

-- Policy: Users can delete connections for their own agents
CREATE POLICY whatsapp_connections_delete_own_agents
  ON whatsapp_agent_connections
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM vibe_agents
      WHERE vibe_agents.id = whatsapp_agent_connections.agent_id
        AND vibe_agents.user_id = auth.uid()
    )
  );

-- Add WhatsApp columns to vibe_agent_conversations
ALTER TABLE vibe_agent_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'web'
    CHECK (channel IN ('web', 'whatsapp')),
  ADD COLUMN IF NOT EXISTS whatsapp_connection_id UUID
    REFERENCES whatsapp_agent_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_message_ids TEXT[] DEFAULT '{}';

-- Index for WhatsApp conversations
CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp
  ON vibe_agent_conversations(whatsapp_connection_id, closed_at)
  WHERE channel = 'whatsapp';

CREATE INDEX IF NOT EXISTS idx_conversations_whatsapp_phone
  ON vibe_agent_conversations(whatsapp_phone_number, agent_id)
  WHERE channel = 'whatsapp';

-- Comment on table
COMMENT ON TABLE whatsapp_agent_connections IS
  'Manages WhatsApp phone number connections to VibeAgents. Allows agents to communicate with users via WhatsApp.';

COMMENT ON COLUMN whatsapp_agent_connections.phone_number IS
  'Phone number in E.164 format with country code (e.g., +919400293288)';

COMMENT ON COLUMN whatsapp_agent_connections.phone_number_normalized IS
  'Phone number with all non-digits removed for searching (e.g., 919400293288)';

COMMENT ON COLUMN whatsapp_agent_connections.status IS
  'Connection status: pending (intro not sent), active (accepting messages), disconnected (manually stopped), expired (auto-expired)';

COMMENT ON COLUMN whatsapp_agent_connections.custom_intro_message IS
  'Optional custom introduction message. If null, uses agent greeting text.';
