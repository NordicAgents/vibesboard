# Collection Mode Greeting UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the static greeting and first LLM question into a single message for collector-mode agents, showing a typing indicator while it generates.

**Architecture:** Pass greeting text into the system prompt so the LLM incorporates it into its first response. Remove the static client-side greeting for collector mode new conversations so only the typing indicator shows while waiting.

**Tech Stack:** React (agent-chat.tsx), TypeScript (prompts.ts)

---

### Task 1: Update system prompt to include greeting text

**Files:**
- Modify: `lib/agent/prompts.ts:52-64`

- [ ] **Step 1: Update getModeInstructions for collector mode**

In `lib/agent/prompts.ts`, replace the collector mode instruction block (lines 55-58) to pass the greeting text and instruct the LLM to incorporate it:

```typescript
// In getModeInstructions(), replace the collector mode return block:
if (agent.mode === 'collector') {
    const fieldsPrompt = getCollectionFieldsPrompt(agent)
    const greeting = agent.greetingText || 'Hi! I have a few questions for you.'
    return `
IMPORTANT - Information Collection Mode:
Your primary goal is to gather specific information from the user efficiently.
- Begin your first response with a brief, friendly greeting based on the following text: "${greeting}". Then naturally lead into your first data collection question. Keep it to one short paragraph — greet and ask in the same message.
- Ask clear, focused questions to collect the required data — one question at a time
- Keep the conversation concise and on-topic
- Do NOT emit the completion marker until you have collected ALL necessary information specified in your instructions${fieldsPrompt ? ' and the required fields listed below' : ''}
- Once you have gathered all the information you need, thank the user briefly and end your response with exactly: ${COMPLETION_MARKERS.COLLECTION_COMPLETE}
- This marker signals that the data collection is complete
- If the user wants to correct a previous answer after collection is complete, help them make the correction, then re-emit ${COMPLETION_MARKERS.COLLECTION_COMPLETE}${fieldsPrompt}`
  }
```

- [ ] **Step 2: Commit**

```bash
git add lib/agent/prompts.ts
git commit -m "feat: pass greeting text into collector mode system prompt"
```

### Task 2: Remove static greeting for collector mode new conversations

**Files:**
- Modify: `components/agent-chat.tsx:92-112`

- [ ] **Step 1: Update defaultInitialMessages to skip greeting in collector mode**

In `components/agent-chat.tsx`, change the greeting/initial messages logic (lines 92-112) so that collector mode new conversations start with an empty message list:

```typescript
  const defaultGreeting = agent.mode === 'collector'
    ? 'Hi! I have a few questions for you.'
    : 'Hi! How can I help you today?'

  // For collector mode new conversations, start empty so typing indicator shows
  // while the LLM generates the combined greeting + first question
  const isNewCollectorChat =
    agent.mode === 'collector' &&
    !initialConversationId &&
    (!initialMessages || initialMessages.length === 0)

  const defaultInitialMessages: Message[] = useMemo(
    () =>
      isNewCollectorChat
        ? []
        : [
            {
              id: nanoid(),
              role: 'assistant',
              content: agent.greetingText || defaultGreeting
            }
          ],
    [chatKey, agent.greetingText, defaultGreeting, isNewCollectorChat]
  )
```

- [ ] **Step 2: Commit**

```bash
git add components/agent-chat.tsx
git commit -m "feat: show typing indicator instead of static greeting for collector mode"
```
