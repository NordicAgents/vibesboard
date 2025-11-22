type GenericTable = {
  Row: Record<string, unknown>
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
}

type GenericView = {
  Row: Record<string, unknown>
}

type GenericFunction = {
  Args: Record<string, unknown>
  Returns: unknown
}

type GenericSchema = {
  Tables: Record<string, GenericTable>
  Views: Record<string, GenericView>
  Functions: Record<string, GenericFunction>
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type PublicSchema = GenericSchema & {
  Tables: {
    chats: {
      Row: {
        id: string
        user_id: string | null
        payload: Json | null
      }
      Insert: {
        id: string
        user_id?: string | null
        payload?: Json | null
      }
      Update: {
        id?: string
        user_id?: string | null
        payload?: Json | null
      }
      Relationships: [
        {
          foreignKeyName: 'chats_user_id_fkey'
          columns: ['user_id']
          referencedRelation: 'users'
          referencedColumns: ['id']
        }
      ]
    }
    vibe_agents: {
      Row: {
        id: string
        user_id: string
        tenant_id: string | null
        name: string
        instructions: string
        file_keys: Json
        agent_url: string
        tools: Json
        allow_anonymous: boolean
        created_at: string
        updated_at: string
      }
      Insert: {
        id?: string
        user_id: string
        tenant_id?: string | null
        name: string
        instructions: string
        file_keys?: Json
        agent_url: string
        tools?: Json
        allow_anonymous?: boolean
        created_at?: string
        updated_at?: string
      }
      Update: {
        id?: string
        user_id?: string
        tenant_id?: string | null
        name?: string
        instructions?: string
        file_keys?: Json
        agent_url?: string
        tools?: Json
        allow_anonymous?: boolean
        created_at?: string
        updated_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'vibe_agents_user_id_fkey'
          columns: ['user_id']
          referencedRelation: 'users'
          referencedColumns: ['id']
        },
        {
          foreignKeyName: 'vibe_agents_tenant_id_fkey'
          columns: ['tenant_id']
          referencedRelation: 'tenants'
          referencedColumns: ['id']
        }
      ]
    }
    tenants: {
      Row: {
        id: string
        name: string
        slug: string
        status: 'active' | 'trial' | 'suspended'
        created_by: string
        created_at: string
        updated_at: string
      }
      Insert: {
        id?: string
        name: string
        slug: string
        status?: 'active' | 'trial' | 'suspended'
        created_by: string
        created_at?: string
        updated_at?: string
      }
      Update: {
        id?: string
        name?: string
        slug?: string
        status?: 'active' | 'trial' | 'suspended'
        created_by?: string
        created_at?: string
        updated_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'tenants_created_by_fkey'
          columns: ['created_by']
          referencedRelation: 'users'
          referencedColumns: ['id']
        }
      ]
    }
    tenant_branding: {
      Row: {
        id: string
        tenant_id: string
        logo_url: string | null
        primary_color: string
        secondary_color: string
        created_at: string
        updated_at: string
      }
      Insert: {
        id?: string
        tenant_id: string
        logo_url?: string | null
        primary_color?: string
        secondary_color?: string
        created_at?: string
        updated_at?: string
      }
      Update: {
        id?: string
        tenant_id?: string
        logo_url?: string | null
        primary_color?: string
        secondary_color?: string
        created_at?: string
        updated_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'tenant_branding_tenant_id_fkey'
          columns: ['tenant_id']
          referencedRelation: 'tenants'
          referencedColumns: ['id']
        }
      ]
    }
    feature_flags: {
      Row: {
        id: string
        name: string
        description: string | null
        default_value: boolean
        created_at: string
      }
      Insert: {
        id?: string
        name: string
        description?: string | null
        default_value?: boolean
        created_at?: string
      }
      Update: {
        id?: string
        name?: string
        description?: string | null
        default_value?: boolean
        created_at?: string
      }
      Relationships: []
    }
    tenant_feature_toggles: {
      Row: {
        tenant_id: string
        feature_flag_id: string
        is_enabled: boolean
        created_at: string
        updated_at: string
      }
      Insert: {
        tenant_id: string
        feature_flag_id: string
        is_enabled: boolean
        created_at?: string
        updated_at?: string
      }
      Update: {
        tenant_id?: string
        feature_flag_id?: string
        is_enabled?: boolean
        created_at?: string
        updated_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'tenant_feature_toggles_tenant_id_fkey'
          columns: ['tenant_id']
          referencedRelation: 'tenants'
          referencedColumns: ['id']
        },
        {
          foreignKeyName: 'tenant_feature_toggles_feature_flag_id_fkey'
          columns: ['feature_flag_id']
          referencedRelation: 'feature_flags'
          referencedColumns: ['id']
        }
      ]
    }
    tenant_users: {
      Row: {
        user_id: string
        tenant_id: string
        role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'
        created_at: string
      }
      Insert: {
        user_id: string
        tenant_id: string
        role: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'
        created_at?: string
      }
      Update: {
        user_id?: string
        tenant_id?: string
        role?: 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'
        created_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'tenant_users_user_id_fkey'
          columns: ['user_id']
          referencedRelation: 'users'
          referencedColumns: ['id']
        },
        {
          foreignKeyName: 'tenant_users_tenant_id_fkey'
          columns: ['tenant_id']
          referencedRelation: 'tenants'
          referencedColumns: ['id']
        }
      ]
    }
    invitations: {
      Row: {
        id: string
        email: string
        tenant_id: string
        token: string
        role: 'TENANT_ADMIN' | 'MEMBER'
        status: 'pending' | 'accepted' | 'expired'
        expires_at: string
        created_by: string
        created_at: string
      }
      Insert: {
        id?: string
        email: string
        tenant_id: string
        token: string
        role: 'TENANT_ADMIN' | 'MEMBER'
        status?: 'pending' | 'accepted' | 'expired'
        expires_at: string
        created_by: string
        created_at?: string
      }
      Update: {
        id?: string
        email?: string
        tenant_id?: string
        token?: string
        role?: 'TENANT_ADMIN' | 'MEMBER'
        status?: 'pending' | 'accepted' | 'expired'
        expires_at?: string
        created_by?: string
        created_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'invitations_tenant_id_fkey'
          columns: ['tenant_id']
          referencedRelation: 'tenants'
          referencedColumns: ['id']
        },
        {
          foreignKeyName: 'invitations_created_by_fkey'
          columns: ['created_by']
          referencedRelation: 'users'
          referencedColumns: ['id']
        }
      ]
    }
    vibe_agent_conversations: {
      Row: {
        id: string
        agent_id: string
        user_id: string | null
        external_id: string | null
        messages: Json
        summary: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id?: string
        agent_id: string
        user_id?: string | null
        external_id?: string | null
        messages?: Json
        summary?: string | null
        created_at?: string
        updated_at?: string
      }
      Update: {
        id?: string
        agent_id?: string
        user_id?: string | null
        external_id?: string | null
        messages?: Json
        summary?: string | null
        created_at?: string
        updated_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'vibe_agent_conversations_agent_id_fkey'
          columns: ['agent_id']
          referencedRelation: 'vibe_agents'
          referencedColumns: ['id']
        },
        {
          foreignKeyName: 'vibe_agent_conversations_user_id_fkey'
          columns: ['user_id']
          referencedRelation: 'users'
          referencedColumns: ['id']
        }
      ]
    }
    vibe_agent_conversation_chunks: {
      Row: {
        id: string
        agent_id: string
        conversation_id: string
        message_index: number
        chunk_index: number
        role: string
        content: string
        embedding: number[] | string | null
        created_at: string
      }
      Insert: {
        id?: string
        agent_id: string
        conversation_id: string
        message_index: number
        chunk_index?: number
        role: string
        content: string
        embedding: number[] | string | null
        created_at?: string
      }
      Update: {
        id?: string
        agent_id?: string
        conversation_id?: string
        message_index?: number
        chunk_index?: number
        role?: string
        content?: string
        embedding?: number[] | string | null
        created_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'vibe_agent_conversation_chunks_agent_id_fkey'
          columns: ['agent_id']
          referencedRelation: 'vibe_agents'
          referencedColumns: ['id']
        },
        {
          foreignKeyName: 'vibe_agent_conversation_chunks_conversation_id_fkey'
          columns: ['conversation_id']
          referencedRelation: 'vibe_agent_conversations'
          referencedColumns: ['id']
        }
      ]
    }
  }
  Views: GenericSchema['Views']
  Functions: GenericSchema['Functions'] & {
    match_agent_conversation_chunks: {
      Args: {
        p_agent_id: string
        p_query_embedding: number[] | string
        p_match_count: number
        p_conversation_id?: string | null
      }
      Returns: {
        conversation_id: string
        message_index: number
        chunk_index: number
        role: string
        content: string
        similarity: number
      }[]
    }
  }
}

export interface Database {
  public: PublicSchema
}
