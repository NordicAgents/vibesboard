-- RAG System Phase 1: Auto-Processing Infrastructure
-- This migration adds:
-- 1. agent_files table for tracking uploaded files and processing status
-- 2. file_id foreign key to agent_file_chunks
-- 3. RAG configuration columns to vibe_agents
-- 4. Helper functions for file management

-- ============================================================================
-- 1. Create agent_files table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  agent_id UUID NOT NULL REFERENCES public.vibe_agents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- File metadata
  file_key TEXT NOT NULL,  -- Storage path in Supabase Storage
  file_name TEXT NOT NULL,
  file_size BIGINT NOT NULL,  -- bytes
  mime_type TEXT NOT NULL,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'indexed', 'failed')),
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  processing_error TEXT,

  -- Indexing metadata
  chunk_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  embedding_model TEXT DEFAULT 'text-embedding-3-small',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Constraints
  UNIQUE(agent_id, file_key)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_agent_files_agent_id ON public.agent_files(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_files_tenant_id ON public.agent_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_files_status ON public.agent_files(status);
CREATE INDEX IF NOT EXISTS idx_agent_files_created_at ON public.agent_files(created_at DESC);

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_agent_files_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_files_updated_at
  BEFORE UPDATE ON public.agent_files
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_files_updated_at();

-- ============================================================================
-- 2. Add file_id to agent_file_chunks
-- ============================================================================

-- Add file_id column (nullable for backward compatibility)
ALTER TABLE public.agent_file_chunks
  ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES public.agent_files(id) ON DELETE CASCADE;

-- Create index for file_id
CREATE INDEX IF NOT EXISTS idx_agent_file_chunks_file_id
  ON public.agent_file_chunks(file_id);

-- ============================================================================
-- 3. Add RAG configuration to vibe_agents
-- ============================================================================

-- Add RAG config columns
ALTER TABLE public.vibe_agents
  ADD COLUMN IF NOT EXISTS rag_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS rag_chunk_count INTEGER DEFAULT 5
    CHECK (rag_chunk_count BETWEEN 1 AND 20),
  ADD COLUMN IF NOT EXISTS rag_similarity_threshold FLOAT DEFAULT 0.7
    CHECK (rag_similarity_threshold BETWEEN 0 AND 1);

-- ============================================================================
-- 4. Row Level Security for agent_files
-- ============================================================================

ALTER TABLE public.agent_files ENABLE ROW LEVEL SECURITY;

-- Service role (server) bypass - for background processing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_files'
      AND policyname = 'agent_files_service_role_all'
  ) THEN
    CREATE POLICY agent_files_service_role_all
      ON public.agent_files
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END;
$$;

-- Tenant members can read files for agents in their tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_files'
      AND policyname = 'agent_files_tenant_read'
  ) THEN
    CREATE POLICY agent_files_tenant_read
      ON public.agent_files
      FOR SELECT
      TO authenticated
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

-- Tenant members can insert files for agents they can edit
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_files'
      AND policyname = 'agent_files_tenant_insert'
  ) THEN
    CREATE POLICY agent_files_tenant_insert
      ON public.agent_files
      FOR INSERT
      TO authenticated
      WITH CHECK (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
        )
        AND agent_id IN (
          SELECT id FROM public.vibe_agents
          WHERE tenant_id IN (
            SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
          )
        )
      );
  END IF;
END;
$$;

-- Tenant members can update files in their tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_files'
      AND policyname = 'agent_files_tenant_update'
  ) THEN
    CREATE POLICY agent_files_tenant_update
      ON public.agent_files
      FOR UPDATE
      TO authenticated
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

-- Tenant members can delete files in their tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'agent_files'
      AND policyname = 'agent_files_tenant_delete'
  ) THEN
    CREATE POLICY agent_files_tenant_delete
      ON public.agent_files
      FOR DELETE
      TO authenticated
      USING (
        tenant_id IN (
          SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid()
        )
      );
  END IF;
END;
$$;

-- ============================================================================
-- 5. Helper Functions
-- ============================================================================

-- Function to get file processing stats for an agent
CREATE OR REPLACE FUNCTION public.get_agent_file_stats(p_agent_id UUID)
RETURNS TABLE (
  total_files BIGINT,
  pending_files BIGINT,
  processing_files BIGINT,
  indexed_files BIGINT,
  failed_files BIGINT,
  total_chunks BIGINT,
  total_size_bytes BIGINT
) LANGUAGE SQL STABLE AS $$
  SELECT
    COUNT(*) as total_files,
    COUNT(*) FILTER (WHERE status = 'pending') as pending_files,
    COUNT(*) FILTER (WHERE status = 'processing') as processing_files,
    COUNT(*) FILTER (WHERE status = 'indexed') as indexed_files,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_files,
    COALESCE(SUM(chunk_count), 0) as total_chunks,
    COALESCE(SUM(file_size), 0) as total_size_bytes
  FROM public.agent_files
  WHERE agent_id = p_agent_id;
$$;

-- Function to mark file as processing
CREATE OR REPLACE FUNCTION public.mark_file_processing(p_file_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.agent_files
  SET
    status = 'processing',
    processing_started_at = NOW(),
    processing_error = NULL
  WHERE id = p_file_id;
END;
$$;

-- Function to mark file as indexed
CREATE OR REPLACE FUNCTION public.mark_file_indexed(
  p_file_id UUID,
  p_chunk_count INTEGER,
  p_total_tokens INTEGER
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.agent_files
  SET
    status = 'indexed',
    processing_completed_at = NOW(),
    chunk_count = p_chunk_count,
    total_tokens = p_total_tokens,
    processing_error = NULL
  WHERE id = p_file_id;
END;
$$;

-- Function to mark file as failed
CREATE OR REPLACE FUNCTION public.mark_file_failed(
  p_file_id UUID,
  p_error TEXT
)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.agent_files
  SET
    status = 'failed',
    processing_completed_at = NOW(),
    processing_error = p_error
  WHERE id = p_file_id;
END;
$$;

-- ============================================================================
-- 6. Comments for documentation
-- ============================================================================

COMMENT ON TABLE public.agent_files IS 'Tracks uploaded files for RAG knowledge bases with processing status';
COMMENT ON COLUMN public.agent_files.status IS 'Processing status: pending (uploaded), processing (being indexed), indexed (ready), failed (error occurred)';
COMMENT ON COLUMN public.agent_files.file_key IS 'Path in Supabase Storage bucket (agent-files)';
COMMENT ON COLUMN public.agent_files.chunk_count IS 'Number of chunks created from this file';
COMMENT ON COLUMN public.agent_files.total_tokens IS 'Approximate token count for cost tracking';

COMMENT ON COLUMN public.vibe_agents.rag_enabled IS 'Whether this agent uses uploaded files for RAG (default: true)';
COMMENT ON COLUMN public.vibe_agents.rag_chunk_count IS 'Number of chunks to retrieve for RAG context (1-20, default: 5)';
COMMENT ON COLUMN public.vibe_agents.rag_similarity_threshold IS 'Minimum similarity score for including chunks (0-1, default: 0.7)';

-- ============================================================================
-- Migration Complete
-- ============================================================================

-- Verify tables exist
DO $$
BEGIN
  ASSERT (SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'agent_files')),
    'agent_files table not created';

  ASSERT (SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'agent_file_chunks' AND column_name = 'file_id')),
    'file_id column not added to agent_file_chunks';

  ASSERT (SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vibe_agents' AND column_name = 'rag_enabled')),
    'rag_enabled column not added to vibe_agents';

  RAISE NOTICE 'RAG System Phase 1 migration completed successfully';
END;
$$;
