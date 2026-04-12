# Collection Mode Greeting UX Redesign

## Problem

When a user opens a collector-mode agent (e.g., via QR code), the current flow shows:
1. A static greeting message instantly (client-side)
2. An auto-triggered hidden "Hi" message fires, and the LLM responds with the first collection question

This results in **two messages appearing before the user has typed anything** — a greeting and a question stacked together. It's confusing and feels like the agent is talking over itself.

## Solution

Merge the greeting and first question into a single LLM-generated message by passing the greeting text into the system prompt instructions. The LLM naturally incorporates the greeting into its first response alongside the first collection question.

### New Flow

```
User scans QR code
  -> Chat opens
  -> Typing indicator shown ("Agent is typing...")
  -> Auto-trigger "Hi" sent to API (same as today)
  -> LLM generates ONE message: greeting + first question
     (e.g., "Hi there! I have a few questions for you. What's your name?")
  -> Message streams in, typing indicator disappears
  -> User replies
  -> Next question...
  -> [COLLECTION_COMPLETE]
```

## Changes Required

### 1. System Prompt (`lib/agent/prompts.ts`)

**Current** (line 55-64): The collector mode instruction says:
> "A greeting message has already been shown to the user. Your first response should immediately begin with your first data collection question. Do not repeat the greeting or ask how you can help."

**New**: Change to pass the greeting text and instruct the LLM to incorporate it:
> "Begin your first response with a brief, friendly greeting based on the following greeting text: '{greetingText}'. Then naturally lead into your first data collection question. Keep it to one short paragraph — greet and ask in the same message."

If no custom `greetingText` is set, use the default: "Hi! I have a few questions for you."

### 2. AgentChat Component (`components/agent-chat.tsx`)

**Remove static greeting for collector mode** (lines 92-112):
- When `agent.mode === 'collector'` and this is a new conversation (no `initialConversationId`, no `initialMessages`), do NOT inject the static greeting into `defaultInitialMessages`.
- Instead, start with an empty message list so only the typing indicator shows.

**Keep static greeting for provider mode**: Provider mode continues to show the greeting as-is (no auto-trigger, user types first).

**Typing indicator**: The existing `TypingIndicator` in `ChatList` already shows when `isLoading` is true. Since the auto-trigger sets `isLoading` to true, the typing indicator will naturally appear while the LLM generates the combined greeting + first question. No new component needed.

### 3. No Other Changes

- Provider mode: unchanged
- API routes: unchanged
- Auto-trigger logic: unchanged (still sends hidden "Hi")
- Completion flow: unchanged
- Collection fields prompt: unchanged

## Edge Cases

- **Custom greeting text**: Works naturally — the custom text gets passed to the system prompt, LLM incorporates it.
- **No greeting text set**: Uses the default greeting text in the prompt instruction.
- **Existing conversations** (user returns to a prior chat): `initialMessages` will be present, so no static greeting is injected and no auto-trigger fires. Unchanged behavior.
- **Slow LLM response**: User sees typing indicator, which is standard chat UX. The response streams in progressively.

## Files to Modify

1. `lib/agent/prompts.ts` — Update `getModeInstructions()` for collector mode
2. `components/agent-chat.tsx` — Skip static greeting for collector mode new conversations
