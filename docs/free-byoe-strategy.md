# Free Platform Strategy: Bring Your Own Everything (BYOE)

## Vision

Make VibeAgent completely free by shifting all variable infrastructure costs to the user. Users bring their own AI API keys, storage backends, and file hosting. VibeAgent becomes a **zero-cost orchestration layer** — the value is the agent builder UX, not the hosted infrastructure.

**Tagline:** _Build AI agents for free. Bring your own brain, your own storage, your own everything._

---

## Why This Works

| Cost Today | Who Pays | BYOE Model |
|---|---|---|
| OpenAI API calls (~$0.002–0.004/msg) | Platform | **User's API key** — $0 for platform |
| Firestore reads/writes | Platform | **User's Firebase project or Supabase** — $0 for platform |
| GCS file storage (vibeagent-files) | Platform | **User's bucket (GCS/S3/R2/Drive)** — $0 for platform |
| Stripe fees (2.9% + 30¢) | Platform | **Eliminated** — nothing to charge |
| Firebase Auth (50k MAU free) | Platform | Keep — free tier covers most usage |
| Vercel hosting | Platform | Keep — Hobby plan is free, or self-host |
| Resend email | Platform | Optional — remove or user-provided SMTP |

**Result:** Platform operating cost approaches **$0/user** at any scale.

---

## What Users Bring

### 1. AI API Key (Required)

The existing `previewToken` pattern in `lib/agent/runtime.ts` already supports user-provided OpenAI keys. Expand this to a first-class multi-provider system.

**Supported providers:**

| Provider | Models | Free Tier? | Notes |
|---|---|---|---|
| **OpenAI** | GPT-4o, GPT-4o-mini, o1, o3 | No | Most capable, existing integration |
| **Anthropic** | Claude Sonnet, Opus, Haiku | No | Strong reasoning, tool use |
| **Google Gemini** | Gemini 2.0 Flash, Pro | **Yes — 15 RPM free** | Best free option for low-volume users |
| **Groq** | Llama 3, Mixtral | **Yes — generous free tier** | Fastest inference, open models |
| **Mistral** | Mistral Large, Small | Limited free | European alternative |
| **OpenRouter** | 100+ models | Pay-per-use | Meta-provider, one key for all models |
| **Ollama (local)** | Llama, Phi, Gemma | **Fully free** | Runs on user's machine, no API key needed |
| **Azure OpenAI** | Same as OpenAI | Enterprise credits | For corporate users with Azure subscriptions |
| **AWS Bedrock** | Claude, Llama, Titan | Enterprise credits | For AWS-native teams |

**Implementation approach:**
- Abstract LLM calls behind a provider interface
- User selects provider + enters API key in Settings → AI Provider
- Keys encrypted at rest (or stored only in browser localStorage for zero-trust)
- Provider-specific adapters handle differences in API format, streaming, tool calling

**Existing code to extend:**
```
lib/openai.ts          → lib/llm/provider.ts (interface)
                        → lib/llm/openai.ts
                        → lib/llm/anthropic.ts
                        → lib/llm/gemini.ts
                        → lib/llm/groq.ts
                        → lib/llm/ollama.ts
lib/agent/runtime.ts   → Accept provider config instead of just previewToken
```

### 2. Database Backend (Required)

Replace the centralized Firestore with a pluggable storage layer. Users choose where their data lives.

**Options:**

| Backend | Free Tier | Multi-Device Sync | Setup Effort | Best For |
|---|---|---|---|---|
| **Browser (IndexedDB)** | Unlimited, truly free | No (single device) | Zero | Solo hobbyists, quick start |
| **Supabase** | 500MB DB, 1GB storage, 50k MAU | Yes | Low (create project, paste URL) | Best balance of free + features |
| **User's Firebase** | 1GB Firestore, 5GB GCS (Spark) | Yes | Medium (create project, export config) | Users already on Google Cloud |
| **PlanetScale** | 5GB, 1B reads/mo | Yes | Low | MySQL-native teams |
| **Turso (LibSQL)** | 9GB, 500 locations | Yes | Low | Edge-first, SQLite-compatible |
| **Neon** | 512MB Postgres | Yes | Low | Postgres-native teams |
| **SQLite file** | Unlimited | No (local only) | Zero | Self-hosted / desktop users |
| **JSON on S3/R2/GCS** | Varies (R2 free egress) | Manual | Medium | Minimal dependency users |

**Implementation approach:**
- Define a `StorageAdapter` interface covering all current Firestore operations
- Ship adapters: `IndexedDBAdapter`, `SupabaseAdapter`, `FirestoreAdapter`, `SQLiteAdapter`
- User picks backend during onboarding or in Settings → Storage
- Migration tool to move data between backends

```typescript
// lib/storage/adapter.ts
export interface StorageAdapter {
  // Agents
  getAgents(tenantId: string): Promise<AgentDocument[]>
  getAgent(tenantId: string, agentId: string): Promise<AgentDocument | null>
  createAgent(tenantId: string, agent: AgentDocument): Promise<void>
  updateAgent(tenantId: string, agentId: string, data: Partial<AgentDocument>): Promise<void>
  deleteAgent(tenantId: string, agentId: string): Promise<void>

  // Conversations
  getConversations(tenantId: string, agentId: string): Promise<ConversationDocument[]>
  getConversation(tenantId: string, agentId: string, convId: string): Promise<ConversationDocument | null>
  createConversation(...): Promise<void>
  appendMessage(...): Promise<void>

  // Files & Chunks (for RAG)
  uploadFileMetadata(...): Promise<void>
  getFileChunks(...): Promise<FileChunk[]>
  vectorSearch(tenantId: string, agentId: string, embedding: number[], limit: number): Promise<FileChunk[]>

  // Tenants & Users
  getTenant(tenantId: string): Promise<TenantDocument | null>
  getUser(userId: string): Promise<UserDocument | null>
  // ... etc
}
```

### 3. File Storage (Required for RAG / Knowledge Base)

Replace the centralized GCS bucket with user-provided storage.

| Storage | Free Tier | Notes |
|---|---|---|
| **Google Drive** | 15GB free | Familiar UX, OAuth-based, API is free |
| **Cloudflare R2** | 10GB, free egress | S3-compatible, no egress fees |
| **AWS S3** | 5GB (12 months free tier) | Most common, user provides credentials |
| **Google Cloud Storage** | 5GB (Always Free) | User's own bucket, signed URLs |
| **Supabase Storage** | 1GB free | Bundled with Supabase DB choice |
| **Local filesystem** | Unlimited | For self-hosted / desktop deployments |
| **IndexedDB blobs** | Limited by browser | Pairs with IndexedDB database option |

**Implementation approach:**
- Define a `FileStorageAdapter` interface
- User provides credentials or OAuth in Settings → File Storage
- For Google Drive: OAuth flow, files stored in an app-specific folder
- For S3/R2/GCS: user provides bucket name + access key

### 4. Embeddings (Required for RAG)

Embeddings are currently tied to OpenAI's `text-embedding-3-small`. With BYOK, embeddings use the same provider system.

| Provider | Model | Free? | Dimensions |
|---|---|---|---|
| **OpenAI** | text-embedding-3-small | No ($0.02/1M tokens) | 1536 |
| **Google** | text-embedding-004 | Free tier available | 768 |
| **Cohere** | embed-english-v3.0 | Free tier (100 calls/min) | 1024 |
| **Ollama** | nomic-embed-text, mxbai-embed | Fully free (local) | 768 |
| **HuggingFace** | Various | Free inference API | Varies |

**Note:** Switching embedding models requires re-indexing existing file chunks (dimensions differ). The migration path should handle this.

---

## What the Platform Still Provides (Free)

These are the things that cost ~$0 to operate and represent VibeAgent's core value:

1. **Agent Builder UI** — The visual interface for creating and configuring agents
2. **Conversation UX** — Chat interface, streaming, typing indicators
3. **RAG Pipeline Logic** — Chunking, embedding orchestration, retrieval strategies
4. **Tool System** — Function calling, data collection, structured outputs
5. **Deployment Channels** — Agent links, embed widget, hook endpoints, WhatsApp/Instagram routing
6. **Firebase Auth** — Free tier covers 50k MAU with OAuth and email/password
7. **Template Library** — Pre-built agent templates and prompt patterns
8. **Open Source Codebase** — Community-driven improvements

---

## Architecture Changes Required

### Current Architecture
```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  Next.js App │────▶│  Our OpenAI  │     │  Our GCS    │
│  (Vercel)    │     │  API Key     │     │  Bucket     │
│              │────▶│  Our Stripe  │     │             │
│              │────▶│  Our Firestore│────▶│  vibeagent- │
│              │     │  (centralized)│     │  files      │
└─────────────┘     └──────────────┘     └─────────────┘
```

### BYOE Architecture
```
┌─────────────┐     ┌──────────────────────────┐
│  Next.js App │────▶│  User's AI Provider      │
│  (Vercel /   │     │  (OpenAI/Anthropic/Gemini│
│   self-host) │     │   /Groq/Ollama/...)      │
│              │     └──────────────────────────┘
│              │────▶┌──────────────────────────┐
│              │     │  User's Database          │
│              │     │  (IndexedDB/Supabase/     │
│              │     │   Firebase/SQLite/...)    │
│              │     └──────────────────────────┘
│              │────▶┌──────────────────────────┐
│              │     │  User's File Storage      │
│              │     │  (Drive/S3/R2/local/...)  │
└─────────────┘     └──────────────────────────┘
```

### Key Abstraction Layers to Build

```
lib/
├── llm/
│   ├── provider.ts         # LLMProvider interface
│   ├── openai.ts           # OpenAI adapter
│   ├── anthropic.ts        # Anthropic adapter
│   ├── gemini.ts           # Google Gemini adapter
│   ├── groq.ts             # Groq adapter
│   ├── ollama.ts           # Local Ollama adapter
│   └── registry.ts         # Provider registry & factory
├── storage/
│   ├── adapter.ts          # StorageAdapter interface
│   ├── indexeddb.ts         # Browser-local storage
│   ├── supabase.ts         # Supabase adapter
│   ├── firestore.ts        # Firebase Firestore adapter (existing, refactored)
│   ├── sqlite.ts           # SQLite adapter (for self-hosted)
│   └── migration.ts        # Data migration between backends
├── files/
│   ├── adapter.ts          # FileStorageAdapter interface
│   ├── google-drive.ts     # Google Drive adapter
│   ├── s3.ts               # S3/R2/GCS adapter
│   ├── supabase-storage.ts # Supabase Storage adapter
│   ├── local.ts            # Local filesystem adapter
│   └── indexeddb-blobs.ts  # Browser blob storage
└── embeddings/
    ├── provider.ts         # EmbeddingProvider interface
    ├── openai.ts           # OpenAI embeddings
    ├── gemini.ts           # Google embeddings
    ├── cohere.ts           # Cohere embeddings
    └── ollama.ts           # Local embeddings
```

---

## Onboarding Flow (New User)

```
1. Sign up (Firebase Auth — free)
      │
2. "Set up your AI provider"
      │
      ├── Option A: Paste OpenAI API key
      ├── Option B: Paste Anthropic API key
      ├── Option C: Connect Google Gemini (OAuth)
      ├── Option D: Use local Ollama (auto-detect)
      └── Option E: Use OpenRouter (one key, all models)
      │
3. "Where should we store your data?"
      │
      ├── Option A: "Just my browser" (IndexedDB — instant, no setup)
      ├── Option B: "My Supabase project" (paste URL + anon key)
      ├── Option C: "My Firebase project" (paste config JSON)
      └── Option D: "I'll self-host" (Docker instructions)
      │
4. "Upload files for your agents?" (optional)
      │
      ├── Option A: Store in browser (pairs with IndexedDB)
      ├── Option B: Google Drive (OAuth connect)
      ├── Option C: S3/R2 bucket (paste credentials)
      └── Option D: Skip for now
      │
5. Create first agent → Start chatting
```

---

## Implementation Phases

### Phase 1: BYOK for AI (1–2 weeks) — Ship This First

**Goal:** Users must provide their own AI key. Remove platform OpenAI costs entirely.

1. Build `LLMProvider` interface and OpenAI adapter (refactor existing `lib/openai.ts`)
2. Add API key management UI in Settings → AI Provider
3. Encrypt and store keys in Firestore (per-tenant)
4. Add Anthropic and Gemini adapters (expand market)
5. Add Groq adapter (gives users a fast, free option)
6. Remove platform `OPENAI_API_KEY` from production env
7. Update all chat endpoints to use tenant's configured provider
8. Remove Stripe billing (or make it optional for future premium features)
9. Update onboarding flow to require AI provider setup

**What stays the same:** Firestore (platform-managed), GCS (platform-managed), Firebase Auth

### Phase 2: Pluggable Database (2–4 weeks)

**Goal:** Users can choose where their data lives. Platform Firestore becomes optional.

1. Define `StorageAdapter` interface covering all data operations
2. Refactor all Firestore calls to go through the adapter
3. Build `IndexedDBAdapter` — zero-setup, browser-local option
4. Build `SupabaseAdapter` — best free tier for cloud storage
5. Keep `FirestoreAdapter` as the default (backward compatible)
6. Add storage backend selector to onboarding and Settings
7. Build data export/import for migration between backends

### Phase 3: Pluggable File Storage (1–2 weeks)

**Goal:** Users choose where uploaded files (knowledge base) are stored.

1. Define `FileStorageAdapter` interface
2. Refactor GCS calls in `lib/gcs.ts` to go through adapter
3. Build Google Drive adapter (most accessible free option)
4. Build S3-compatible adapter (covers S3, R2, GCS, MinIO)
5. Build IndexedDB blob adapter (pairs with Phase 2 browser option)
6. Add file storage selector to Settings

### Phase 4: Self-Hosted Distribution (2–4 weeks)

**Goal:** Users can run VibeAgent entirely on their own infrastructure.

1. Create `Dockerfile` and `docker-compose.yml`
2. SQLite adapter for zero-dependency database
3. Local filesystem adapter for file storage
4. Ollama integration for fully offline AI
5. Configuration via environment variables or `.env` file
6. One-command deploy: `docker compose up`
7. Publish to Docker Hub / GitHub Container Registry

### Phase 5: Open Source & Community (Ongoing)

**Goal:** Build a community around the free platform.

1. Open-source the core repo (MIT or AGPL license)
2. Community plugin system for custom providers and adapters
3. Template marketplace (community-contributed agent templates)
4. Documentation site with setup guides per backend
5. Discord/community forum for support

---

## Revenue Model (Post-Free)

Even with a fully free core, there are sustainable revenue paths:

| Revenue Stream | Model | Target |
|---|---|---|
| **Managed Hosting** | "Don't want to set up your own infra? We'll host it." $9–29/mo | Non-technical users, small businesses |
| **Team Collaboration** | Free for solo, paid for multi-user workspaces | Teams, agencies |
| **Premium Templates** | Marketplace for advanced agent templates | Power users |
| **White-Label / Custom Domain** | Remove VibeAgent branding, custom domain | Businesses embedding agents |
| **Priority Support** | SLA, dedicated support channel | Enterprise |
| **Analytics Add-on** | Advanced usage analytics, conversation insights | Data-driven teams |
| **Plugin Marketplace** | Revenue share on paid integrations | Developers |
| **Consulting / Setup** | Done-for-you agent builds | Enterprise |

### Comparable Success Stories

| Product | Model | Revenue |
|---|---|---|
| **Cal.com** | Open-source scheduling, paid hosting | $millions ARR |
| **Supabase** | Open-source Firebase alt, paid hosting | $80M+ ARR |
| **n8n** | Open-source automation, paid cloud | $40M+ ARR |
| **Appsmith** | Open-source internal tools, paid cloud | $25M+ ARR |
| **Chatwoot** | Open-source support, paid hosting | Growing |

---

## Competitive Advantage

By going BYOE, VibeAgent differentiates from:

| Competitor | Their Model | VibeAgent BYOE Advantage |
|---|---|---|
| **Chatbase** | $19–399/mo, locked to their infra | Free, user owns everything |
| **Botpress** | Free tier limited, paid cloud | No vendor lock-in |
| **Voiceflow** | $50+/mo for teams | Zero cost at any scale |
| **CustomGPT** | $49+/mo | User picks their own AI model |
| **Stack AI** | $199+/mo | Self-hostable, open source |

**The pitch:** _"Why pay $50/month for an agent builder when you can use VibeAgent for free with your own API key?"_

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| UX complexity (too many choices) | Smart defaults: OpenAI + IndexedDB as "quick start" |
| Support burden for self-hosters | Community forum, comprehensive docs, Docker one-click |
| Key security (users paste API keys) | Browser-only storage option (localStorage), encryption at rest |
| Provider API differences | Comprehensive adapter testing, graceful degradation |
| No revenue initially | Managed hosting upsell, keep lean team |
| Data loss (browser storage) | Clear warnings, easy export, encourage cloud backends |
| Embedding model migration | Track model + dimensions per chunk, re-index tool |

---

## Decision Log

| Decision | Chosen | Rationale |
|---|---|---|
| Default storage for new users | IndexedDB (browser) | Zero friction, instant start, no account needed |
| Default AI suggestion | Gemini Flash (free tier) or user's OpenAI key | Lowest barrier to entry |
| Key storage | Encrypted in chosen backend + option for browser-only | Balances security with simplicity |
| License | TBD (MIT vs AGPL) | MIT for adoption, AGPL to protect managed hosting business |
| Billing system | Keep Stripe code but make it optional | Needed for managed hosting tier |
| Auth | Keep centralized Firebase Auth | Free for 50k MAU, essential for the hosted version |
