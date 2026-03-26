# Tenant-Specific RAG System - Comprehensive Plan

**Last Updated:** 2026-02-18
**Status:** Planning Phase
**Priority:** High

---

## Executive Summary

This document outlines a comprehensive plan to implement a **tenant-specific RAG (Retrieval-Augmented Generation) system** that allows users to upload documents, create knowledge bases, and build AI agents powered by their own data. This system will be multi-tenant, secure, and scalable.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Use Cases & Requirements](#use-cases--requirements)
3. [System Architecture](#system-architecture)
4. [Implementation Phases](#implementation-phases)
5. [Database Schema](#database-schema)
6. [API Endpoints](#api-endpoints)
7. [UI Components](#ui-components)
8. [Security & Compliance](#security--compliance)
9. [Performance Considerations](#performance-considerations)
10. [Testing Strategy](#testing-strategy)

---

## Current State Analysis

### ✅ **What Already Exists**

#### 1. **File Upload Infrastructure**
- **Location:** `components/agents/agent-builder.tsx:67-99`
- **Storage:** Supabase Storage bucket `agent-files`
- **Current Flow:**
  ```typescript
  // Users can upload files when creating agents
  const handleUpload = async (files: FileList | null) => {
    const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`
    await supabase.storage.from('agent-files').upload(path, file)
    setFileKeys(prev => [...prev, data.path])
  }
  ```
- **Limitations:**
  - Files stored but NOT automatically processed
  - No vectorization on upload
  - No knowledge base management

#### 2. **File Ingestion & Vectorization**
- **Location:** `lib/agent/file-search.ts`
- **Capabilities:**
  - Extract text from: PDF, DOCX, XLSX, CSV, TXT, MD, HTML, Images (via GPT-4V)
  - Chunk text (1200 chars, 200 overlap)
  - Generate embeddings (OpenAI `text-embedding-3-small`)
  - Store in `agent_file_chunks` table
- **API:** `POST /api/agents/[id]/files/ingest`
- **Limitations:**
  - Manual trigger required (not automatic on upload)
  - No UI for triggering ingestion
  - No batch processing

#### 3. **File Search/RAG**
- **Location:** `lib/agent/file-search.ts:369-441`
- **Function:** `searchAgentFileChunks(agentId, query, limit)`
- **Uses:** PostgreSQL RPC `match_agent_file_chunks` for vector similarity search
- **Fallback:** Text-based ILIKE search if RPC fails

#### 4. **Conversation RAG (Ask AI)**
- **Location:** `lib/agent/conversation-rag.ts`
- **Purpose:** Search through visitor conversations for Ask AI feature
- **Tables:** `vibe_agent_conversation_chunks` with embeddings
- **Sync:** Manual sync via `POST /api/agents/[id]/conversations/sync-embeddings`

#### 5. **Database Tables**
- ✅ `vibe_agents` - Agent metadata, `file_keys: string[]`
- ✅ `agent_file_chunks` - Chunked documents with embeddings
- ✅ `vibe_agent_conversation_chunks` - Conversation embeddings for Ask AI
- ✅ Storage bucket: `agent-files`

### ❌ **What's Missing**

1. **Automatic Processing:** Files uploaded but not auto-vectorized
2. **Knowledge Base Management:** No UI to view/manage uploaded documents
3. **Document Status Tracking:** No way to know if file is processed/indexed
4. **Batch Operations:** No bulk upload or bulk ingestion
5. **Multi-tenant Isolation:** File chunks not explicitly scoped to tenant
6. **Search UI:** No interface to search uploaded documents
7. **Agent Configuration:** No way to enable/disable RAG per agent
8. **Analytics:** No tracking of RAG usage, chunk counts, or search metrics

---

## Use Cases & Requirements

### Primary Use Cases

#### UC1: **Customer Support Agent with Company Knowledge Base**
**User Story:** As a customer support manager, I want to upload our FAQ docs, product manuals, and support scripts so our AI agent can answer customer questions accurately using our company's knowledge.

**Requirements:**
- Upload multiple PDFs, DOCX files
- Automatic vectorization after upload
- Agent searches knowledge base before answering
- Clear indication of source documents in responses

#### UC2: **Legal/Compliance Agent with Case Law**
**User Story:** As a legal professional, I want to upload case documents, legal precedents, and compliance guidelines so the agent can provide accurate legal guidance based on our firm's knowledge.

**Requirements:**
- Support large documents (100+ pages)
- Accurate text extraction from legal PDFs
- Citation of specific document sections
- Secure, tenant-isolated storage

#### UC3: **HR Agent with Company Policies**
**User Story:** As an HR manager, I want to upload our employee handbook, benefits guides, and policy documents so employees can ask questions and get accurate answers about company policies.

**Requirements:**
- Version control (update policies)
- Delete old policy versions
- Highlight which policy document was referenced

#### UC4: **Product Knowledge Agent**
**User Story:** As a product manager, I want to upload product specs, technical documentation, and release notes so our sales team can get accurate product information from the AI agent.

**Requirements:**
- Support technical diagrams (images)
- Update docs without breaking existing agents
- Search across multiple knowledge bases

### Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR1 | Upload files during agent creation | ✅ Exists |
| FR2 | Upload files to existing agents | 🟡 Missing |
| FR3 | Auto-vectorize files on upload | 🔴 Critical |
| FR4 | View uploaded documents (list) | 🔴 Critical |
| FR5 | Delete uploaded documents | 🟡 Important |
| FR6 | See processing status (pending/indexed/failed) | 🟡 Important |
| FR7 | Search knowledge base (testing) | 🟢 Nice-to-have |
| FR8 | Enable/disable RAG per agent | 🟡 Important |
| FR9 | Set # of retrieved chunks | 🟢 Nice-to-have |
| FR10 | Multi-file batch upload | 🟡 Important |
| FR11 | Re-process failed files | 🟢 Nice-to-have |
| FR12 | Knowledge base analytics | 🟢 Nice-to-have |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR1 | File upload max size | 25 MB per file |
| NFR2 | Supported file types | PDF, DOCX, XLSX, TXT, MD, CSV, HTML, Images |
| NFR3 | Processing time (per file) | < 30 seconds for typical doc |
| NFR4 | Embedding generation time | < 5 seconds for 100 chunks |
| NFR5 | Vector search latency | < 500ms for top 10 results |
| NFR6 | Tenant data isolation | 100% - RLS enforced |
| NFR7 | Concurrent uploads | Support 10 parallel uploads |
| NFR8 | Storage quota per tenant | Configurable (default: 1 GB) |

---

## System Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        User Actions                                  │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  1. Upload Files                                                     │
│     ┌─────────────────────────────────────────────────────────┐    │
│     │  UI: Agent Builder / Knowledge Base Manager              │    │
│     │  API: POST /api/agents/[id]/files                        │    │
│     │  Storage: Supabase Storage (agent-files bucket)          │    │
│     └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  2. Trigger Auto-Processing (NEW)                                   │
│     ┌─────────────────────────────────────────────────────────┐    │
│     │  Background Job: Process uploaded file                   │    │
│     │  Extract Text → Chunk → Embed → Store                    │    │
│     │  Update: agent_files table (status: processing/indexed)  │    │
│     └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  3. Store Vectorized Chunks                                          │
│     ┌─────────────────────────────────────────────────────────┐    │
│     │  Table: agent_file_chunks                                │    │
│     │  Columns: agent_id, file_id, content, embedding          │    │
│     │  Index: pgvector index for fast similarity search        │    │
│     └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  4. Agent Chat with RAG                                              │
│     ┌─────────────────────────────────────────────────────────┐    │
│     │  User asks question → Embed query                        │    │
│     │  Search knowledge base (vector similarity)               │    │
│     │  Retrieve top K chunks → Add to prompt context           │    │
│     │  LLM generates answer with sources                       │    │
│     └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                        │
├──────────────────────────────────────────────────────────────────┤
│  • Agent Builder (file upload)                                    │
│  • Knowledge Base Manager (NEW)                                   │
│  • File List & Status                                             │
│  • Processing Indicators                                          │
└──────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────────────────────────────────────────────────┐
│                     API Routes (Next.js)                          │
├──────────────────────────────────────────────────────────────────┤
│  POST   /api/agents/[id]/files              Upload files          │
│  GET    /api/agents/[id]/files              List files            │
│  DELETE /api/agents/[id]/files/[fileId]     Delete file           │
│  POST   /api/agents/[id]/files/[fileId]/reprocess  Re-process     │
│  GET    /api/agents/[id]/knowledge-base/search     Test search    │
│  POST   /api/agents/[id]/knowledge-base/sync-all   Batch process  │
└──────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────────────────────────────────────────────────┐
│                      Business Logic Layer                         │
├──────────────────────────────────────────────────────────────────┤
│  lib/agent/file-ingestion.ts     File upload & orchestration      │
│  lib/agent/file-processor.ts     Background processing (NEW)      │
│  lib/agent/file-search.ts        Extract, chunk, embed (existing) │
│  lib/agent/rag-retriever.ts      Vector search & ranking (NEW)    │
│  lib/agent/runtime.ts             Chat with RAG integration        │
└──────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────────────────────────────────────────────────┐
│                      Data Layer (Supabase)                        │
├──────────────────────────────────────────────────────────────────┤
│  agent_files (NEW)                File metadata & status           │
│  agent_file_chunks (existing)     Vectorized chunks                │
│  vibe_agents (existing)           Agent config                     │
│  Storage: agent-files (existing)  Binary file storage              │
└──────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────────────────────────────────────────────────┐
│                     External Services                             │
├──────────────────────────────────────────────────────────────────┤
│  OpenAI Embeddings API            text-embedding-3-small           │
│  OpenAI Vision API                GPT-4V for image text extraction │
└──────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)

**Goal:** Auto-process uploaded files and track status

#### Tasks:
1. **Create `agent_files` table**
   - Track file metadata (name, size, type, status)
   - Link to agent and tenant
   - Processing status enum: `pending`, `processing`, `indexed`, `failed`

2. **Update file upload flow**
   - Insert row in `agent_files` on upload (status: `pending`)
   - Trigger background processing job

3. **Implement background processor**
   - Queue-based system (consider using Vercel Cron or BullMQ)
   - Process files in batches
   - Update status as processing progresses
   - Error handling & retry logic

4. **Update agent creation**
   - Link uploaded files to `agent_files` table
   - Display processing status in UI

#### Deliverables:
- ✅ Migration file for `agent_files` table
- ✅ Background job for auto-processing
- ✅ Updated upload API with status tracking
- ✅ File status indicator in UI

---

### Phase 2: Knowledge Base UI (Week 3)

**Goal:** Give users visibility and control over their knowledge base

#### Tasks:
1. **Create Knowledge Base page**
   - Route: `/agents/[id]/knowledge-base`
   - List all uploaded files with status
   - Show processing progress
   - Delete files
   - Re-process failed files

2. **Add to agent builder**
   - "Manage Knowledge Base" button
   - Upload additional files to existing agents
   - Real-time status updates

3. **File details modal**
   - View chunks generated
   - See extracted text preview
   - Chunk count and embedding stats

#### Deliverables:
- ✅ Knowledge base management page
- ✅ File upload UI improvements
- ✅ Processing status indicators
- ✅ Delete and re-process actions

---

### Phase 3: Enhanced RAG Integration (Week 4)

**Goal:** Make RAG actually work during agent chats

#### Tasks:
1. **Integrate RAG into agent chat**
   - Location: `lib/agent/runtime.ts`
   - On user message → embed query
   - Search `agent_file_chunks` (top 5-8 chunks)
   - Add context to system prompt
   - Track RAG usage per message

2. **Agent configuration options**
   - Enable/disable RAG toggle
   - Set number of chunks to retrieve (default: 5)
   - Set similarity threshold (0.7 default)
   - Configure which files to include (all vs. selected)

3. **Source attribution**
   - Return source file names with responses
   - Add "Sources:" section to agent responses
   - Link to original documents (if accessible)

#### Deliverables:
- ✅ RAG integrated into agent runtime
- ✅ Agent settings for RAG configuration
- ✅ Source attribution in responses
- ✅ RAG usage tracking

---

### Phase 4: Advanced Features (Week 5-6)

**Goal:** Power user features and optimization

#### Tasks:
1. **Batch operations**
   - Bulk upload (drag & drop multiple files)
   - Batch processing progress
   - Re-index all files

2. **Search testing interface**
   - Test knowledge base search
   - View retrieved chunks
   - Debug similarity scores

3. **Analytics dashboard**
   - Total docs uploaded per tenant
   - Total chunks indexed
   - RAG query count
   - Most-retrieved documents
   - Failed processing errors

4. **Performance optimizations**
   - Implement caching for embeddings
   - Optimize vector search queries
   - Add pagination for large knowledge bases

5. **Multi-knowledge-base support**
   - Create named knowledge bases
   - Agents can use multiple KBs
   - Share KBs across agents (within tenant)

#### Deliverables:
- ✅ Bulk upload UI
- ✅ Search testing tool
- ✅ Analytics dashboard
- ✅ Performance improvements
- ✅ Multi-KB support (optional)

---

## Database Schema

### New Table: `agent_files`

```sql
CREATE TABLE agent_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  agent_id UUID NOT NULL REFERENCES vibe_agents(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- File metadata
  file_key TEXT NOT NULL,  -- Storage path
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

  -- Indexes
  UNIQUE(agent_id, file_key)
);

-- Indexes for performance
CREATE INDEX idx_agent_files_agent_id ON agent_files(agent_id);
CREATE INDEX idx_agent_files_tenant_id ON agent_files(tenant_id);
CREATE INDEX idx_agent_files_status ON agent_files(status);
CREATE INDEX idx_agent_files_created_at ON agent_files(created_at DESC);

-- RLS Policies
ALTER TABLE agent_files ENABLE ROW LEVEL SECURITY;

-- Users can read files for agents in their tenant
CREATE POLICY "Users can read tenant agent files"
  ON agent_files FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Users can insert files for agents they can edit
CREATE POLICY "Users can insert agent files"
  ON agent_files FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
    AND agent_id IN (
      SELECT id FROM vibe_agents WHERE tenant_id IN (
        SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
      )
    )
  );

-- Users can update files for agents they can edit
CREATE POLICY "Users can update agent files"
  ON agent_files FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );

-- Users can delete files for agents they can edit
CREATE POLICY "Users can delete agent files"
  ON agent_files FOR DELETE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM tenant_users WHERE user_id = auth.uid()
    )
  );
```

### Update: `agent_file_chunks`

**Add `file_id` foreign key to link chunks to `agent_files`:**

```sql
ALTER TABLE agent_file_chunks
  ADD COLUMN file_id UUID REFERENCES agent_files(id) ON DELETE CASCADE;

CREATE INDEX idx_agent_file_chunks_file_id ON agent_file_chunks(file_id);
```

### Update: `vibe_agents`

**Add RAG configuration:**

```sql
ALTER TABLE vibe_agents
  ADD COLUMN rag_enabled BOOLEAN DEFAULT true,
  ADD COLUMN rag_chunk_count INTEGER DEFAULT 5 CHECK (rag_chunk_count BETWEEN 1 AND 20),
  ADD COLUMN rag_similarity_threshold FLOAT DEFAULT 0.7 CHECK (rag_similarity_threshold BETWEEN 0 AND 1);
```

---

## API Endpoints

### File Management

#### 1. **Upload Files**
```
POST /api/agents/[agentId]/files
```

**Request Body:**
```json
{
  "files": [
    {
      "fileKey": "user123/1234567890-document.pdf",
      "fileName": "Company Policy.pdf",
      "fileSize": 1048576,
      "mimeType": "application/pdf"
    }
  ],
  "autoProcess": true  // Optional, default true
}
```

**Response:**
```json
{
  "files": [
    {
      "id": "uuid",
      "fileKey": "user123/1234567890-document.pdf",
      "fileName": "Company Policy.pdf",
      "status": "pending",
      "createdAt": "2026-02-18T10:00:00Z"
    }
  ]
}
```

#### 2. **List Files**
```
GET /api/agents/[agentId]/files?status=indexed&page=1&limit=20
```

**Response:**
```json
{
  "files": [
    {
      "id": "uuid",
      "fileName": "Company Policy.pdf",
      "fileSize": 1048576,
      "mimeType": "application/pdf",
      "status": "indexed",
      "chunkCount": 45,
      "createdAt": "2026-02-18T10:00:00Z",
      "processingCompletedAt": "2026-02-18T10:00:23Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 12,
    "totalPages": 1
  }
}
```

#### 3. **Delete File**
```
DELETE /api/agents/[agentId]/files/[fileId]
```

**Response:**
```json
{
  "success": true,
  "message": "File and 45 chunks deleted successfully"
}
```

#### 4. **Re-process File**
```
POST /api/agents/[agentId]/files/[fileId]/reprocess
```

**Response:**
```json
{
  "success": true,
  "status": "processing",
  "message": "File queued for re-processing"
}
```

#### 5. **Get File Details**
```
GET /api/agents/[agentId]/files/[fileId]
```

**Response:**
```json
{
  "id": "uuid",
  "fileName": "Company Policy.pdf",
  "fileSize": 1048576,
  "mimeType": "application/pdf",
  "status": "indexed",
  "chunkCount": 45,
  "totalTokens": 12000,
  "embeddingModel": "text-embedding-3-small",
  "createdAt": "2026-02-18T10:00:00Z",
  "processingCompletedAt": "2026-02-18T10:00:23Z",
  "chunks": [
    {
      "chunkIndex": 0,
      "content": "This is the company policy...",
      "tokenCount": 250
    }
  ]
}
```

### Knowledge Base Operations

#### 6. **Search Knowledge Base**
```
POST /api/agents/[agentId]/knowledge-base/search
```

**Request Body:**
```json
{
  "query": "What is the vacation policy?",
  "limit": 5,
  "minSimilarity": 0.7
}
```

**Response:**
```json
{
  "results": [
    {
      "fileId": "uuid",
      "fileName": "HR Handbook.pdf",
      "chunkIndex": 12,
      "content": "Employees are entitled to 15 days of paid vacation...",
      "similarity": 0.92
    }
  ],
  "totalResults": 5
}
```

#### 7. **Sync All Files**
```
POST /api/agents/[agentId]/knowledge-base/sync-all
```

**Response:**
```json
{
  "success": true,
  "processed": 8,
  "failed": 0,
  "totalChunks": 342
}
```

---

## UI Components

### 1. **Knowledge Base Manager Page**

**Route:** `/agents/[id]/knowledge-base`

**Components:**
- File upload dropzone
- File list table (name, size, status, chunks, actions)
- Processing progress indicators
- Delete confirmation modal
- Re-process button for failed files
- Search testing panel

**Features:**
- Real-time status updates (polling or WebSocket)
- Drag & drop multiple files
- Filter by status (all, pending, indexed, failed)
- Pagination for large file lists

### 2. **Agent Builder Enhancement**

**Location:** `components/agents/agent-builder.tsx`

**Additions:**
- "Manage Knowledge Base" button (links to KB page)
- File status badges next to uploaded files
- Processing indicators
- Quick stats (X files, Y chunks indexed)

### 3. **Agent Settings - RAG Configuration**

**New Section in Agent Settings:**

```tsx
<Card>
  <CardHeader>
    <CardTitle>Knowledge Base (RAG)</CardTitle>
    <CardDescription>
      Control how your agent uses uploaded documents to answer questions
    </CardDescription>
  </CardHeader>
  <CardContent>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Enable RAG</Label>
        <Switch checked={ragEnabled} onCheckedChange={setRagEnabled} />
      </div>

      {ragEnabled && (
        <>
          <div>
            <Label>Retrieved Chunks</Label>
            <Select value={chunkCount} onValueChange={setChunkCount}>
              <SelectOption value="3">3 chunks</SelectOption>
              <SelectOption value="5">5 chunks (recommended)</SelectOption>
              <SelectOption value="8">8 chunks</SelectOption>
              <SelectOption value="10">10 chunks</SelectOption>
            </Select>
          </div>

          <div>
            <Label>Similarity Threshold</Label>
            <Slider
              min={0.5}
              max={0.9}
              step={0.05}
              value={similarityThreshold}
              onChange={setSimilarityThreshold}
            />
            <p className="text-xs text-muted-foreground">
              Current: {similarityThreshold} (higher = more relevant results)
            </p>
          </div>
        </>
      )}
    </div>
  </CardContent>
</Card>
```

### 4. **Search Testing Interface**

**Component:** `components/agents/knowledge-base-search-tester.tsx`

**Features:**
- Input field for test query
- Search button
- Display retrieved chunks with:
  - Source file name
  - Similarity score
  - Chunk content
  - Highlight matching terms

---

## Security & Compliance

### Multi-Tenancy Isolation

**Database Level:**
- All tables include `tenant_id` column
- RLS policies enforce tenant isolation
- No cross-tenant data access

**API Level:**
- Validate user belongs to tenant
- Check agent ownership before file operations
- Use service role only for background jobs

**Storage Level:**
- Files stored under `{tenantId}/{agentId}/` prefix
- Supabase Storage policies enforce access control

### Data Privacy

**File Retention:**
- Soft delete option (mark as deleted, keep for 30 days)
- Hard delete removes storage + DB records + chunks

**Encryption:**
- Files encrypted at rest (Supabase default)
- Embeddings stored as plaintext (vectors)
- No PII in chunk content (user responsibility)

**Audit Trail:**
- Track file uploads (who, when)
- Log processing events
- Monitor search queries (optional, privacy-aware)

---

## Performance Considerations

### Optimization Strategies

#### 1. **Embedding Caching**
- Cache query embeddings for common questions
- TTL: 1 hour
- Reduces OpenAI API costs

#### 2. **Batch Processing**
- Process multiple files concurrently (limit: 5)
- Use worker threads for CPU-intensive tasks
- Queue system for high-volume uploads

#### 3. **Vector Search Optimization**
- Use pgvector HNSW index for fast ANN search
- Pre-filter by agent_id before vector search
- Limit chunk retrieval to top K (5-10)

#### 4. **Chunk Size Tuning**
- Default: 1200 chars, 200 overlap
- For technical docs: 800 chars (more precise)
- For FAQs: 1500 chars (broader context)

#### 5. **Database Indexes**
```sql
-- Already exists
CREATE INDEX idx_agent_file_chunks_agent_id ON agent_file_chunks(agent_id);

-- Add compound index for filtered searches
CREATE INDEX idx_agent_file_chunks_agent_file
  ON agent_file_chunks(agent_id, file_id);

-- Vector index (pgvector)
CREATE INDEX ON agent_file_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### Scalability Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Files per agent | 100 | Reasonable for most use cases |
| Chunks per agent | 10,000 | ~8-10 MB of text content |
| Search latency (p95) | < 500ms | Including embedding + vector search |
| Processing throughput | 20 files/min | Across all tenants |
| Concurrent uploads | 10 per tenant | Rate limiting |

---

## Testing Strategy

### Unit Tests

**Files to Test:**
- `lib/agent/file-processor.ts` - Background processing logic
- `lib/agent/rag-retriever.ts` - Vector search & ranking
- `lib/agent/file-search.ts` - Existing, add coverage

**Test Cases:**
- ✅ Extract text from various file types
- ✅ Chunk text with correct overlap
- ✅ Generate embeddings (mock OpenAI)
- ✅ Vector search returns correct results
- ✅ Error handling for corrupt files

### Integration Tests

**Scenarios:**
1. **Upload → Process → Search flow**
   - Upload PDF
   - Wait for processing
   - Search for content
   - Verify results

2. **Agent chat with RAG**
   - Upload knowledge base
   - Ask question
   - Verify RAG context in prompt
   - Check source attribution

3. **Multi-tenant isolation**
   - Create agents for 2 tenants
   - Upload docs to each
   - Verify Tenant A can't access Tenant B's docs

### E2E Tests

**User Journeys:**
1. Create agent → Upload docs → Chat with RAG
2. Manage knowledge base → Delete file → Verify chunks removed
3. Failed processing → Re-process → Verify success

---

## Timeline & Milestones

| Phase | Duration | Deliverables | Target Date |
|-------|----------|--------------|-------------|
| **Phase 1** | 2 weeks | Auto-processing, status tracking | Week 2 |
| **Phase 2** | 1 week | Knowledge base UI | Week 3 |
| **Phase 3** | 1 week | RAG integration into chat | Week 4 |
| **Phase 4** | 2 weeks | Advanced features, optimization | Week 6 |
| **Testing** | 1 week | E2E testing, bug fixes | Week 7 |
| **Production** | - | Deploy to production | Week 8 |

---

## Success Metrics

### Launch Criteria
- ✅ Auto-processing works for all supported file types
- ✅ RAG integration tested with 10+ real documents
- ✅ UI fully functional (upload, view, delete, search)
- ✅ RLS policies verified (multi-tenant isolation)
- ✅ Performance targets met (< 500ms search)

### Post-Launch KPIs
- **Adoption:** % of agents with knowledge bases
- **Usage:** RAG queries per day
- **Quality:** User feedback on answer accuracy
- **Performance:** p95 search latency
- **Cost:** OpenAI API spend for embeddings

---

## Open Questions & Decisions Needed

1. **Queue System:** Use Vercel Cron (simple) or BullMQ (robust)?
2. **Storage Limits:** Hard cap per tenant or soft warnings?
3. **Embedding Model:** Stick with `text-embedding-3-small` or allow customization?
4. **File Versioning:** Support updating files (v1, v2) or just replace?
5. **Shared Knowledge Bases:** Allow multiple agents to share one KB?
6. **Real-time Updates:** WebSocket for processing status or polling?
7. **Analytics:** How much to track? Privacy implications?
8. **Pricing:** Charge extra for RAG/knowledge base usage?

---

## Next Steps

1. **Review this plan** with the team
2. **Get user feedback** on priorities (which features are must-have?)
3. **Create Phase 1 tasks** in project management tool
4. **Set up dev environment** for testing file processing
5. **Start implementation** with Phase 1 (auto-processing)

---

**End of Document**
