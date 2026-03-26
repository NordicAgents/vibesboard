# RAG System - Quick Reference

**TL;DR:** Enable tenants to upload documents, auto-vectorize them, and have their AI agents answer questions using their own knowledge base.

---

## Current State vs. Desired State

### ✅ What Works Now
- Users can upload files when creating agents
- Files are stored in Supabase Storage
- Manual API endpoint exists to process files (`POST /api/agents/[id]/files/ingest`)
- Vector search works (`lib/agent/file-search.ts`)

### ❌ What's Broken/Missing
- **No auto-processing** - Files uploaded but never vectorized
- **No UI** - Can't see what's uploaded, processing status, or manage files
- **RAG not integrated** - Agents don't actually use uploaded docs during chat
- **No tracking** - Can't tell if file processed successfully

---

## The Fix (4 Phases)

### Phase 1: Auto-Process Files (2 weeks)
**Goal:** When user uploads file → automatically extract text → chunk → embed → store

**Key Changes:**
1. Create `agent_files` table (track file metadata + status)
2. Background job to process uploaded files
3. Update upload API to trigger processing
4. Show "Processing..." status in UI

### Phase 2: Knowledge Base UI (1 week)
**Goal:** Give users a page to manage their uploaded documents

**Features:**
- View all uploaded files
- See processing status (pending/processing/indexed/failed)
- Delete files
- Re-process failed files
- Upload more files to existing agents

### Phase 3: RAG Integration (1 week)
**Goal:** Agents actually use uploaded docs to answer questions

**How it works:**
1. User asks question
2. System embeds the question
3. Search knowledge base for relevant chunks (top 5)
4. Add chunks to LLM prompt as context
5. LLM generates answer with sources

**Config Options:**
- Enable/disable RAG per agent
- Set number of chunks (3-10)
- Set similarity threshold (0.5-0.9)

### Phase 4: Advanced Features (2 weeks)
**Goal:** Power user features

**Features:**
- Bulk upload
- Search testing tool
- Analytics (total docs, chunks, queries)
- Performance optimizations

---

## Key Concepts

### RAG (Retrieval-Augmented Generation)
Instead of LLM guessing, it searches your knowledge base first, then answers based on actual documents.

**Example:**
```
User: "What's our vacation policy?"

Without RAG:
Agent: "I don't have access to your specific vacation policy."

With RAG:
Agent: "According to your HR Handbook, employees are entitled to 15 days
of paid vacation per year. [Source: HR_Handbook.pdf, page 12]"
```

### Vector Embeddings
Text converted to numbers (vectors) so we can measure semantic similarity.

**Example:**
- "vacation days" → [0.23, -0.45, 0.12, ...]
- "paid time off" → [0.21, -0.43, 0.14, ...]
- Similarity: 0.92 (very similar!)

### Chunking
Break long documents into smaller pieces (chunks) that fit in LLM context window.

**Example:**
```
Document: 100-page PDF (200,000 characters)
↓
Chunks: 167 chunks × 1,200 chars each
↓
Only top 5 most relevant chunks sent to LLM (6,000 chars total)
```

---

## Architecture Diagram

```
┌─────────────────────┐
│   User uploads PDF  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────┐
│  Supabase Storage (agent-files) │
└──────────┬──────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Background Job                       │
│  1. Download PDF                      │
│  2. Extract text                      │
│  3. Split into chunks (1200 chars)    │
│  4. Embed chunks (OpenAI API)         │
│  5. Store in DB (agent_file_chunks)   │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Database: agent_file_chunks          │
│  - agent_id                           │
│  - file_id                            │
│  - content (text chunk)               │
│  - embedding (vector)                 │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  User asks question in chat           │
│  "What's the refund policy?"          │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  1. Embed question                    │
│  2. Vector search (find top 5 chunks) │
│  3. Add chunks to LLM prompt          │
│  4. LLM generates answer              │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Agent: "Customers can request a full │
│  refund within 30 days of purchase.   │
│  [Source: Return_Policy.pdf]"         │
└───────────────────────────────────────┘
```

---

## Database Schema (Simplified)

### New Table: `agent_files`
Tracks uploaded files and processing status.

```sql
agent_files:
  - id (UUID)
  - agent_id (FK to vibe_agents)
  - tenant_id (FK to tenants)
  - file_key (storage path)
  - file_name
  - status (pending/processing/indexed/failed)
  - chunk_count
  - created_at
```

### Existing Table: `agent_file_chunks`
Stores vectorized chunks.

```sql
agent_file_chunks:
  - id (UUID)
  - agent_id (FK)
  - file_id (FK to agent_files) ← NEW
  - content (text)
  - embedding (vector)
  - chunk_index
```

---

## API Quick Reference

### Upload Files
```bash
POST /api/agents/[agentId]/files
Body: { files: [{ fileKey, fileName, fileSize, mimeType }] }
Response: { files: [{ id, status: "pending" }] }
```

### List Files
```bash
GET /api/agents/[agentId]/files
Response: { files: [{ id, fileName, status, chunkCount }] }
```

### Delete File
```bash
DELETE /api/agents/[agentId]/files/[fileId]
Response: { success: true }
```

### Search Knowledge Base
```bash
POST /api/agents/[agentId]/knowledge-base/search
Body: { query: "vacation policy", limit: 5 }
Response: { results: [{ fileName, content, similarity }] }
```

---

## Use Cases

### 1. Customer Support Agent
**Uploads:** FAQ docs, product manuals, troubleshooting guides
**Result:** Agent answers support questions accurately using company docs

### 2. HR Assistant
**Uploads:** Employee handbook, benefits guide, policy documents
**Result:** Employees ask questions about policies, get instant accurate answers

### 3. Legal/Compliance Agent
**Uploads:** Case law, legal precedents, compliance guidelines
**Result:** Provides legally accurate guidance based on firm's knowledge

### 4. Sales Enablement
**Uploads:** Product specs, pricing sheets, competitive analysis
**Result:** Sales team gets instant access to product knowledge

---

## Implementation Checklist

### Phase 1 (Auto-Processing)
- [ ] Create `agent_files` migration
- [ ] Implement background processor
- [ ] Update upload API
- [ ] Add status tracking UI

### Phase 2 (Knowledge Base UI)
- [ ] Create `/agents/[id]/knowledge-base` page
- [ ] File list with status indicators
- [ ] Delete file functionality
- [ ] Re-process failed files

### Phase 3 (RAG Integration)
- [ ] Integrate RAG into agent chat runtime
- [ ] Add RAG config to agent settings
- [ ] Source attribution in responses
- [ ] RAG usage tracking

### Phase 4 (Advanced)
- [ ] Bulk upload
- [ ] Search testing interface
- [ ] Analytics dashboard
- [ ] Performance optimizations

---

## Testing Scenarios

### Happy Path
1. Upload PDF → Status: "Processing"
2. Wait 10s → Status: "Indexed" (45 chunks)
3. Ask question → Agent uses RAG → Returns answer with source

### Error Handling
1. Upload corrupt PDF → Status: "Failed" → Error message shown
2. Re-process → Status: "Processing" → Try again

### Multi-Tenant Isolation
1. Tenant A uploads doc
2. Tenant B can't see it
3. Tenant B's agent can't search it

---

## Performance Targets

| Metric | Target |
|--------|--------|
| File processing | < 30s per file |
| Embedding generation | < 5s per 100 chunks |
| Vector search | < 500ms |
| Total RAG overhead | < 1s added to chat response |

---

## Costs (Estimated)

### OpenAI Embeddings
- Model: `text-embedding-3-small`
- Cost: $0.02 per 1M tokens
- Example: 100-page PDF ≈ 200K tokens ≈ $0.004

### Storage
- Supabase: Included in plan (1 GB free tier)
- Vector storage: ~4KB per chunk × 1000 chunks = 4 MB

**Total:** Very low cost, mostly from embeddings (~$0.01 per large document)

---

## Questions to Answer

1. **Auto-process or manual?** → Auto (Phase 1)
2. **Background job system?** → Vercel Cron (simple) or BullMQ (robust)?
3. **Storage limits?** → 1 GB per tenant (soft limit with warnings)
4. **Shared knowledge bases?** → Phase 4 (optional)
5. **File versioning?** → Simple replace for now, versioning in Phase 4

---

**Next Step:** Review full plan in `TENANT_RAG_SYSTEM_PLAN.md` and start Phase 1 implementation.
