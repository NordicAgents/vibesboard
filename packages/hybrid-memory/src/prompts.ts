/**
 * All LLM prompts for the hybrid pipeline.
 * Keeping prompts in one file makes them easy to override or version.
 */

// ─── Stage 1: Observation Formation ──────────────────────────────────────────

export function observationFormationPrompt(conversation: string): string {
  return `You are a memory analyst. Read the following conversation and extract factual observations about the user's behavior, preferences, goals, or communication style.

Each observation must be:
- A single declarative sentence (the statement)
- Paired with a direct quote or specific reference from the conversation (the evidence)
- Grounded — only extract what is explicitly shown, not inferred

Return a JSON array. If nothing noteworthy is observed, return [].

Format:
[
  { "statement": "...", "evidence": "..." },
  ...
]

Conversation:
${conversation}

Observations (JSON only, no other text):`
}

// ─── Stage 2: Observation Reconciliation ─────────────────────────────────────

export function reconciliationPrompt(params: {
  observation: string
  siblingObservations: string[]
  relevantMessages: string[]
  existingMemoryToc: string
  existingMemoryExcerpts: string
}): string {
  const siblings = params.siblingObservations.length
    ? params.siblingObservations.map((s, i) => `${i + 1}. ${s}`).join('\n')
    : 'None'

  const messages = params.relevantMessages.length
    ? params.relevantMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')
    : 'None'

  return `You are a memory reconciliation agent. Your job is to decide whether a new observation warrants a change to the long-term memory store.

## New Observation
${params.observation}

## Related Observations (from other conversations)
${siblings}

## Relevant Message History
${messages}

## Current Memory Tree (table of contents)
${params.existingMemoryToc || 'Empty — no memories yet'}

## Relevant Memory Excerpts
${params.existingMemoryExcerpts || 'None'}

## Instructions
Decide one of three cases:

**CASE 1 — Mutate**: The observation (possibly combined with the related evidence) clearly warrants adding, modifying, or deleting a memory.
**CASE 2 — Defer**: The observation is suggestive but needs more evidence from future conversations.
**CASE 3 — Discard**: The observation is a one-off, already captured, or not worth remembering.

For CASE 1, produce one or more mutations. Use existing memory keys where possible; create new slash-delimited keys only when necessary.

Return JSON in exactly this format:
{
  "decision": "mutate" | "defer" | "discard",
  "reasoning": "one sentence",
  "mutations": [
    {
      "operation": "add" | "modify" | "delete",
      "key": "/path/to/memory",
      "description": "short ToC label (for add/modify)",
      "content": "memory body text (for add/modify)",
      "presenceClass": "omnipresent" | "pattern" | "on-demand",
      "triggerPatterns": ["keyword1", "keyword2"],
      "memoryId": "existing id (for modify/delete only)"
    }
  ]
}

JSON only, no other text:`
}

// ─── Explicit capture summarization ──────────────────────────────────────────

export function explicitCapturePrompt(rawInput: string, existingToc: string): string {
  return `You are a memory assistant. The agent wants to save the following information to long-term memory:

"${rawInput}"

Current memory tree:
${existingToc || 'Empty'}

Classify and structure this as a memory:
- Choose an appropriate slash-delimited key (reuse existing paths when relevant)
- Write a short description (< 80 chars) for the table of contents
- Choose a presence class: omnipresent (always needed), pattern (triggered by keywords), on-demand (lookup only)
- If pattern, suggest 1-3 trigger keywords

Return JSON:
{
  "key": "/path/to/memory",
  "description": "...",
  "presenceClass": "omnipresent" | "pattern" | "on-demand",
  "triggerPatterns": ["keyword"] | [],
  "content": "cleaned and concise memory body"
}

JSON only:`
}
