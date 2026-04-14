# TODO

Features and improvements that are planned but not yet implemented.

---

## LLM Usage & Audit Logging

**Priority:** High
**Status:** Not started

### Background
Currently there is no LLM call tracking anywhere. `lib/analytics.ts` is Vercel Web Analytics for page views only. Conversations are stored in Firestore but there is no per-call usage or audit log.

### What to build

**Per LLM call, record:**
- `agentId`, `tenantId`
- `timestamp`
- `model` — model name used
- `messageCount` — number of messages sent in the request
- `inputTokenEstimate` / `outputTokenEstimate` — approximate token counts
- `retrievalStrategy` — `direct` / `rag` / `bash`
- `toolCalled` — tool name if a tool was invoked, else `null`
- `latencyMs` — time from request start to stream completion
- `source` — `chat` / `public_chat` / `hook` / `whatsapp`

**Firestore path:**
```
/tenants/{tenantId}/usage_logs/{logId}
```
One document per LLM call, queryable by agent, date, and source.

### What this enables
- Per-agent call counts
- Per-tenant usage rollups
- Audit trail for billing and debugging
- Tool usage stats (how often bash vs RAG vs direct is used)
- Latency monitoring per agent/strategy

### Implementation plan
1. Write the log inside `runtime.ts` `onCompletion` callback — already fires after every LLM call
2. Add `usage_logs` collection path to `lib/firestore-types.ts`
3. Add `UsageLogDocument` interface to `lib/firestore-types.ts`
4. Optionally add a UI in the settings page (super admin only) to view usage per tenant/agent

---
