# Ask AI — Chart Tool Plan

## Goal
Agent owners can ask questions about their conversation data and get chart visualisations inline in the Ask AI chat.

## Approach
- AI returns a `\`\`\`chart` fenced block (JSON) inside its response when a chart is appropriate
- `ChatMessage` detects `language-chart` code fence → renders `<ChartWidget>` instead of a code block
- No hook changes required if staying on ai v2; upgrade to ai v3/v4 needed for native tool invocations

## Chart config format (Chart.js compatible)
```json
{
  "type": "bar" | "line" | "pie" | "doughnut",
  "title": "string",
  "labels": ["string"],
  "datasets": [{ "label": "string", "data": [number], "color": "string?" }]
}
```

## Files to create/change
1. `components/ui/chart-widget.tsx` — new, renders react-chartjs-2 chart from config
2. `components/chat-message.tsx` — intercept `language-chart` code fence → render ChartWidget
3. `app/api/agents/[id]/conversations/ask/route.ts` — update system prompt to instruct AI to emit chart fences
4. `package.json` — add react-chartjs-2 + chart.js

## System prompt addition for Ask AI
```
When the answer involves counts, trends, or comparisons over time, include a chart using this exact format after your text response:

\`\`\`chart
{ "type": "bar", "title": "...", "labels": [...], "datasets": [{ "label": "...", "data": [...] }] }
\`\`\`

Only include a chart when data supports it. Never invent data.
```

## Upgrade dependency
- **ai v2.1.6** (current): useCompletion streams raw text — chart-in-fence approach works without any hook changes
- **ai v3/v4** (future): enables native toolInvocations on messages — cleaner but requires migrating OpenAIStream + StreamingTextResponse in 6 files

## Upgrade impact (ai v2 → v4)
| Import | Status in v4 | Migration |
|---|---|---|
| `OpenAIStream` | Removed | Replace with `streamText().toDataStreamResponse()` + `@ai-sdk/openai` |
| `StreamingTextResponse` | Removed | Replace with `streamText().toDataStreamResponse()` |
| `Message` type | Unchanged | No action |

### Files affected by upgrade
- `app/api/chat/route.ts`
- `app/api/agents/[id]/chat/route.ts`
- `app/api/agents/[id]/conversations/ask/route.ts`
- `app/api/agent-helper/route.ts`
- `app/api/agent-creator/route.ts`
- `app/api/public/agents/[agentId]/chat/route.ts`
- `app/api/smoke/route.ts`

## Recommended order
1. Build chart feature using fence approach (works on current ai v2) ← start here
2. Separately plan ai v3/v4 upgrade as its own PR
3. After upgrade, optionally migrate to native tool invocations
