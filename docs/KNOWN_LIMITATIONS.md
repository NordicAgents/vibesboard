# Known Limitations

This file tracks known limitations, constraints, and intentional trade-offs in the platform. Items here are acknowledged but not yet prioritised for fixing.

---

## Agent Runtime

### Single tool call per turn (no agentic loop)

**Area:** `lib/agent/runtime.ts` — `runResponsesAgentWithTools`

**What it means:**
The runtime executes at most one tool call per conversation turn. After the model's first tool result is returned, the final answer is streamed immediately — the model cannot request additional tool calls in the same turn.

**Current flow:**
```
User message → model picks tool → execute tool → stream final answer
```

**What this limits:**
- Multi-step bash analysis (e.g. run `wc -l` then `awk` on the same file)
- Chained file searches where the first result informs a follow-up query
- Any task that naturally requires 2+ tool calls to answer accurately

**Workaround:**
Users can ask follow-up questions to trigger additional tool calls in subsequent turns.

**Ideal fix:**
An agentic loop that continues executing tool calls until the model stops requesting them, with a hard cap (e.g. 5 iterations per turn) to prevent runaway loops.

**Affected strategies:** Bash, RAG (file_search), Web Fetch

---

## Retrieval Strategies

### Bash strategy requires files to be uploaded

**Area:** `lib/retrieval/strategies/bash.ts`

**What it means:**
The Bash retrieval strategy only activates if the agent has at least one file uploaded. If no files exist, the sandbox is never created and no bash tool is registered — the agent falls back to a plain context response with no tools.

**Why:**
Creating an in-memory virtual filesystem with no files to mount is pointless overhead. The bash tool's entire value is analyzing uploaded files.

**Impact on users:**
If a user selects the Bash strategy but hasn't uploaded any files, the agent will behave as if no retrieval strategy is set — no bash tool will be available in the conversation.

---
