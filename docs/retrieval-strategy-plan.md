# Agent File Retrieval Strategy Plan

**Last Updated:** 2026-03-26
**Status:** Planning
**Priority:** High

---

## Overview

Allow admins to configure how each agent retrieves and interacts with its uploaded files. Three strategies are supported:

| Strategy | Description | Best For |
|---|---|---|
| `direct` | Load full file content into the system prompt | Small files, few docs, full context needed every turn |
| `rag` | Vector search at query time, return top-K chunks | Large files, many docs, only relevant sections needed |
| `bash` | LLM runs shell commands via `just-bash` virtual sandbox | Structured data (CSV, JSON, YAML), code files, analytical queries |

---

## Architecture Principle: Isolation-Ready

The retrieval layer is designed as a **standalone module** (`lib/retrieval/`) with a clean contract so it can be extracted into its own service if scaling demands it.

```
lib/retrieval/
  index.ts            — public API: createRetriever(strategy, config) => Retriever
  types.ts            — shared interfaces (Retriever, RetrieverConfig, RetrieverResult)
  strategies/
    direct.ts         — DirectRetriever (loads files into context)
    rag.ts            — RagRetriever (vector search)
    bash.ts           — BashRetriever (just-bash sandbox)
```

### Contract

```ts
interface RetrieverConfig {
  agentId: string
  tenantId: string
  fileKeys: string[]
  fileContext?: string | null
}

interface RetrieverResult {
  contextText: string          // injected into system prompt
  tools: RegisteredTool[]      // tools to add to the toolkit
  sources: string[]            // file names / labels used
  hasOverflow: boolean         // true if some files couldn't fit
}

interface Retriever {
  /** One-time setup at request start (download files, warm cache, etc.) */
  prepare(): Promise<void>
  /** Build context + tools for this request */
  build(query?: string): Promise<RetrieverResult>
  /** Cleanup (optional — bash cleans up its sandbox) */
  dispose(): Promise<void>
}
```

This contract means:
- `context-builder.ts` becomes a thin orchestrator that delegates to the selected retriever
- Each strategy is independently testable
- The entire `lib/retrieval/` folder can be packaged as `@vibeagent/retrieval` and deployed as a microservice behind an HTTP boundary if needed
- The HTTP boundary would be: `POST /retrieve { strategy, config, query } => RetrieverResult`

---

## Data Model

### New Field on Agent

```ts
// lib/types.ts — VibeAgent
retrievalStrategy?: 'direct' | 'rag' | 'bash'  // default: 'direct'

// lib/firestore-types.ts — AgentDocument
retrievalStrategy?: 'direct' | 'rag' | 'bash'
```

One field, no migration needed. Absence = `'direct'` (backward compatible).

---

## Strategy Details

### 1. Direct (existing behavior)

- Downloads files from GCS via `readFullFileContent()`
- Inserts full text into system prompt (30k char budget, 60% for files)
- Removes `file_search` tool if all files fit
- Zero changes to existing code path

### 2. RAG

- Skips file loading into system prompt
- Injects `file_search` tool into toolkit unconditionally
- `file_search` tool calls `rag-retriever.ts` > Firestore `findNearest` vector search
- Files must be pre-ingested via `ingestFileForAgent()` (already exists)
- Re-activates the currently orphaned `rag-retriever.ts` pipeline

### 3. Bash (via `just-bash`)

**Package:** [`just-bash`](https://www.npmjs.com/package/just-bash) by Vercel
- Simulated bash environment with in-memory virtual filesystem
- No host filesystem access, no network by default
- Execution limits: `maxCommandCount`, `maxLoopIterations`, `maxCallDepth`

**Runtime flow:**
1. Download file content from GCS (same as direct)
2. Create `new Bash()` instance with execution limits
3. Write files into virtual FS at `/home/user/project/`
4. Inject `builtin:bash` tool into toolkit
5. LLM calls bash tool with command string
6. Run `bash.exec(command)`, return stdout (capped 8000 chars)
7. Instance is GC'd after request — no cleanup needed

**Available commands (built into just-bash):**
- **Text:** `grep`, `rg`, `awk`, `sed`, `head`, `tail`, `cat`, `sort`, `uniq`, `wc`, `cut`, `tr`, `diff`
- **Data:** `jq` (JSON), `xan` (CSV), `yq` (YAML/XML/TOML)
- **Files:** `ls`, `find`, `stat`, `tree`
- **Disabled:** Python, JavaScript runtimes (off by default, we keep them off)

**Security config:**
```ts
const bash = new Bash({
  executionLimits: {
    maxCallDepth: 50,
    maxCommandCount: 500,
    maxLoopIterations: 5000,
    maxAwkIterations: 5000,
    maxSedIterations: 5000
  }
  // python: false (default)
  // javascript: false (default)
  // network: not enabled
})
```

---

## Implementation Phases

### Phase 1 — Retrieval Module Scaffold + Direct Strategy

**Goal:** Extract current direct-loading logic into the new retrieval module without changing behavior.

**Files:**
- `lib/retrieval/types.ts` — `Retriever`, `RetrieverConfig`, `RetrieverResult` interfaces
- `lib/retrieval/strategies/direct.ts` — `DirectRetriever` (extract from `context-builder.ts`)
- `lib/retrieval/index.ts` — `createRetriever()` factory
- `lib/agent/context-builder.ts` — refactor to delegate to `createRetriever('direct', ...)`
- `lib/types.ts` — add `RetrievalStrategy` type, `retrievalStrategy` field to `VibeAgent`
- `lib/firestore-types.ts` — add `retrievalStrategy` to `AgentDocument`

**Outcome:** Zero behavior change. All existing agents continue working. New module is in place.

### Phase 2 — RAG Strategy

**Goal:** Wire up the existing (currently orphaned) RAG pipeline as a retrieval strategy.

**Files:**
- `lib/retrieval/strategies/rag.ts` — `RagRetriever` wrapping `rag-retriever.ts` + `file-search` tool
- `lib/retrieval/index.ts` — handle `'rag'` in factory
- `lib/agent/context-builder.ts` — pass strategy through

**Outcome:** Agents set to `rag` use vector search instead of full-context loading. Existing `ingestFileForAgent` handles ingestion.

### Phase 3 — Bash Strategy (just-bash)

**Goal:** Add `just-bash` as a retrieval strategy with sandboxed shell execution.

**Files:**
- Install `just-bash` dependency
- `lib/retrieval/strategies/bash.ts` — `BashRetriever` (creates sandbox, writes files, provides tool)
- `lib/agent/tools/base.ts` — add `'builtin:bash'` stub to `BUILTIN_TOOL_FACTORIES`
- `lib/agents/constants.ts` — add `builtin:bash` to `BUILTIN_AGENT_TOOLS`
- `lib/types.ts` — add `'builtin:bash'` to `AgentToolType`
- `lib/retrieval/index.ts` — handle `'bash'` in factory

**Outcome:** Agents set to `bash` get a shell tool. LLM can run `jq`, `grep`, `awk` etc. against uploaded files in a virtual sandbox.

### Phase 4 — Admin UI

**Goal:** Let admins pick retrieval strategy per agent.

**Files:**
- `components/agents/agent-retrieval-settings.tsx` — radio group: Direct / RAG / Bash with descriptions
- `components/agents/agent-rightbar.tsx` — mount the new component (visible when agent has files)
- `app/api/agents/[id]/route.ts` — accept `retrievalStrategy` in PATCH

**Outcome:** Admins can switch strategy from the agent settings panel. Change takes effect on next conversation.

### Phase 5 — Extraction & Scaling (Future)

**Goal:** If load demands it, extract `lib/retrieval/` into a standalone service.

- Package as `@vibeagent/retrieval`
- Deploy behind HTTP: `POST /retrieve { strategy, config, query }`
- vibeagent calls the service instead of running retrieval in-process
- No changes to the admin UI or agent model

---

## UI Design

In the agent rightbar, below tools / above danger zone:

```
File Retrieval Strategy
(only shown when agent.fileKeys.length > 0)

  ( ) Direct — Loads full file content into every conversation
      Best for: Small files, few documents

  ( ) RAG — Searches relevant sections on demand
      Best for: Large files, many documents

  ( ) Bash — Gives the agent shell commands to analyze files
      Best for: CSV, JSON, structured data, code files
```

---

## Alternatives Considered

| Alternative | Why not |
|---|---|
| Custom sandboxed bash (allowlist + child_process) | Reinventing the wheel. `just-bash` handles parsing, piping, execution limits, virtual FS. |
| WebAssembly sandbox (wasm-shell) | Overkill for text processing. Higher complexity, larger bundle. |
| Single strategy for all agents | Different file types benefit from different strategies. CSV in full context wastes tokens; small docs in RAG adds latency. |
| Store strategy on tenant level | Too coarse. Different agents within a tenant may have different file profiles. |
| Always use all three | Unnecessary complexity and cost. Let the admin choose what fits. |

---

## Dependencies

| Package | Version | Size | Purpose |
|---|---|---|---|
| `just-bash` | ^2.14.0 | 18.8 MB | Virtual bash sandbox for bash strategy |

No other new dependencies. RAG uses existing `openai-edge` + Firestore vector search.

---

## Security Summary

| Strategy | Risk Surface | Mitigations |
|---|---|---|
| Direct | Token cost (large files fill context) | 30k char budget, file budget ratio |
| RAG | Embedding API cost | Ingestion runs once per file, cached in Firestore |
| Bash | Command execution | Virtual FS only, no host access, no network, execution limits, no Python/JS runtimes |

---

## Open Questions

1. Should we allow combining strategies? (e.g., direct + bash for small files with analytical queries) — **Recommendation: No, keep it simple. One strategy per agent.**
2. Should bash strategy auto-ingest for RAG as fallback? — **Recommendation: No, keep strategies independent.**
3. Max file size for bash strategy? — Files must fit in memory. Recommend same 30k char limit per file, but allow more files since they're not in the prompt.
