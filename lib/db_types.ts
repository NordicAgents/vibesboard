type GenericRelationship = {
  foreignKeyName: string
  columns: string[]
  isOneToOne?: boolean
  referencedRelation: string
  referencedColumns: string[]
}

type GenericTable = {
  Row: Record<string, unknown>
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
  Relationships: GenericRelationship[]
}

type GenericView = {
  Row: Record<string, unknown>
  Insert: Record<string, unknown>
  Update: Record<string, unknown>
  Relationships: GenericRelationship[]
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
        name: string
        instructions: string
        file_keys: Json
        agent_url: string
        tools: Json
        allow_anonymous: boolean
        greeting_text: string | null
        created_at: string
        updated_at: string
      }
      Insert: {
        id?: string
        user_id: string
        name: string
        instructions: string
        file_keys?: Json
        agent_url: string
        tools?: Json
        allow_anonymous?: boolean
        greeting_text?: string | null
        created_at?: string
        updated_at?: string
      }
      Update: {
        id?: string
        user_id?: string
        name?: string
        instructions?: string
        file_keys?: Json
        agent_url?: string
        tools?: Json
        allow_anonymous?: boolean
        greeting_text?: string | null
        created_at?: string
        updated_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'vibe_agents_user_id_fkey'
          columns: ['user_id']
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
    agent_file_chunks: {
      Row: {
        id: string
        agent_id: string
        file_key: string
        file_name: string
        mime_type: string | null
        chunk_index: number
        content: string
        embedding: number[] | string | null
        created_at: string
      }
      Insert: {
        id?: string
        agent_id: string
        file_key: string
        file_name: string
        mime_type?: string | null
        chunk_index: number
        content: string
        embedding?: number[] | string | null
        created_at?: string
      }
      Update: {
        id?: string
        agent_id?: string
        file_key?: string
        file_name?: string
        mime_type?: string | null
        chunk_index?: number
        content?: string
        embedding?: number[] | string | null
        created_at?: string
      }
      Relationships: [
        {
          foreignKeyName: 'agent_file_chunks_agent_id_fkey'
          columns: ['agent_id']
          referencedRelation: 'vibe_agents'
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
    match_agent_file_chunks: {
      Args: {
        agent_id: string
        query_embedding: number[] | string
        match_count?: number
      }
      Returns: {
        file_key: string
        file_name: string
        mime_type: string | null
        chunk_index: number
        content: string
        similarity: number
      }[]
    }
  }
}

export interface Database {
  public: PublicSchema
}
