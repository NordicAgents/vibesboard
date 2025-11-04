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
  }
  Views: GenericSchema['Views']
  Functions: GenericSchema['Functions']
}

export interface Database {
  public: PublicSchema
}
