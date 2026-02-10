// WhatsApp Integration Types

export type WhatsAppConnectionStatus = 'pending' | 'active' | 'disconnected' | 'expired';

export interface WhatsAppAgentConnection {
  id: string;
  agent_id: string;
  user_id: string;
  phone_number: string;
  phone_number_normalized: string;
  status: WhatsAppConnectionStatus;
  custom_intro_message: string | null;
  intro_message_sent_at: string | null;
  intro_message_id: string | null;
  last_message_received_at: string | null;
  total_conversations: number;
  connected_at: string | null;
  disconnected_at: string | null;
  expires_at: string | null;
  disconnection_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateConnectionParams {
  agent_id: string;
  phone_number: string;
  custom_intro_message?: string;
  send_intro_immediately?: boolean;
  expires_at?: Date;
}

export interface UpdateConnectionParams {
  status?: WhatsAppConnectionStatus;
  intro_message_sent_at?: Date;
  intro_message_id?: string;
  last_message_received_at?: Date;
  total_conversations?: number;
  connected_at?: Date;
  disconnected_at?: Date;
  disconnection_reason?: string;
  expires_at?: Date;
}

export interface WhatsAppConnectionWithAgent extends WhatsAppAgentConnection {
  agent: {
    id: string;
    name: string;
    mode: 'provider' | 'collector';
    greeting_text: string | null;
    instructions: string;
    quick_suggestions_mode: 'off' | 'smart' | 'always';
    quick_suggestions_count: 3 | 4;
  };
}

export interface ConnectionListResponse {
  connections: WhatsAppAgentConnection[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DisconnectConnectionParams {
  conversation_action: 'keep' | 'archive' | 'delete';
}
