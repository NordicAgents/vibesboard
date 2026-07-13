import { createOpenAI } from '@ai-sdk/openai'
import { streamText as aiStreamText } from 'ai'
import { type Message } from '@vibesboard/contracts'

import { buildAgentSystemPrompt } from './prompts.ts'
import { buildAgentContext } from './context-builder.ts'
import { type VibeAgent } from '@vibesboard/contracts'
import { type ToolExecutionContext, type ToolKit } from './tools/index.ts'
import {
  OPENAI_CHAT_MODEL,
  completeText,
  isResponsesModel,
  streamText,
  type ResponsesApiTool
} from '@vibesboard/adapter-openai'
import { resolveProviderSpec } from './tenant-llm-config.ts'
import { buildProviderModel } from './provider-registry.ts'

interface RunAgentStreamArgs {
  agent: VibeAgent
  messages: Message[]
  context?: string | null
  previewToken?: string | null
  temperature?: number
  onCompletion?: (
    completion: string,
    usage?: { promptTokens: number; completionTokens: number }
  ) => Promise<void> | void
  toolContext?: ToolExecutionContext
  handoffTargetNames?: Record<string, string>
  remainingResponses?: number | null
}

export async function runAgentStream({
  agent,
  messages,
  context,
  previewToken,
  temperature = 0.1,
  onCompletion,
  toolContext,
  handoffTargetNames,
  remainingResponses
}: RunAgentStreamArgs) {
  // Check for tenant-scoped LLM config (agent-specific → tenant default → global).
  // previewToken bypasses tenant config so the agent preview always uses the platform key.
  const tenantSpec =
    !previewToken && agent.tenantId
      ? await resolveProviderSpec(agent.tenantId, agent.llmConfigId, undefined, 'chat').catch((err) => {
          console.error('[runtime] Failed to resolve tenant LLM config — falling back to platform model:', err)
          return null
        })
      : null

  if (tenantSpec) {
    return runAgentStreamWithSpec({
      agent,
      messages,
      context,
      temperature,
      onCompletion,
      toolContext,
      handoffTargetNames,
      remainingResponses,
      spec: tenantSpec,
    })
  }

  const model = OPENAI_CHAT_MODEL
  const isResponses = isResponsesModel(model)

  // Build context by pre-loading file content and source URLs.
  // This also prunes the toolkit (removes file_search if all files fit in context).
  // NOTE: dispose() must be called after the stream completes — not before — so
  // that retriever-owned sandboxes (e.g. BashRetriever) remain live during tool execution.
  const agentContext = await buildAgentContext(agent, toolContext)
  const effectiveContext = agentContext.contextText || context || null
  const toolkit = agentContext.toolkit

  if (isResponses && toolkit.functions.length) {
    return runResponsesAgentWithTools({
      agent,
      messages,
      context: effectiveContext,
      toolkit,
      model,
      previewToken,
      onCompletion: async (completion, usage) => {
        await agentContext.dispose()
        if (onCompletion) await onCompletion(completion, usage)
      },
      toolContext,
      hasFileOverflow: agentContext.hasFileOverflow,
      handoffTargetNames,
      remainingResponses
    })
  }

  const systemPrompt = buildAgentSystemPrompt(agent, effectiveContext, {
    hasFileOverflow: agentContext.hasFileOverflow,
    handoffTargetNames,
    remainingResponses
  })

  if (isResponses) {
    const conversation = formatConversation(messages)
    const prompt = `${systemPrompt}\n\n${
      conversation ? `Conversation so far:\n${conversation}` : ''
    }`

    const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null
    const stream = await streamText({
      prompt,
      model,
      apiKey,
      async onDone(completion, usage) {
        await agentContext.dispose()
        if (onCompletion) {
          const mapped = usage
            ? {
                promptTokens: usage.inputTokens,
                completionTokens: usage.outputTokens
              }
            : undefined
          await onCompletion(completion, mapped)
        }
      }
    })

    return stream
  }

  // TODO: handoffTargetNames is not passed here — agents on the legacy Chat
  // Completions path will not have handoff instructions injected into their
  // system prompt. Low impact since OPENAI_CHAT_MODEL is a Responses API model
  // in all current deployments. Fix by passing handoffTargetNames when removing
  // or consolidating this legacy path.
  const systemPromptLegacy = buildAgentSystemPrompt(agent, effectiveContext, {
    remainingResponses
  })
  const payload = [
    { role: 'system' as const, content: systemPromptLegacy },
    ...messages.map(message => ({
      role: message.role as 'system' | 'user' | 'assistant',
      content: typeof message.content === 'string' ? message.content : ''
    }))
  ]

  const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? ''
  const openaiClient = createOpenAI({ apiKey })

  let disposed = false
  const safeDispose = async () => {
    if (disposed) return
    disposed = true
    await agentContext.dispose()
  }

  const result = await aiStreamText({
    model: openaiClient(model),
    messages: payload,
    temperature,
    async onFinish({ text, usage }) {
      await safeDispose()
      if (onCompletion) {
        const mapped = usage
          ? {
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens
            }
          : undefined
        await onCompletion(text, mapped)
      }
    }
  })

  return textStreamToReadable(result.textStream, () => safeDispose().catch(() => {}))
}

/**
 * Convert an AsyncIterable<string> text stream → ReadableStream<Uint8Array>.
 * Uses pull() for backpressure. onCancel fires when the client disconnects.
 */
function textStreamToReadable(
  textStream: AsyncIterable<string>,
  onCancel?: () => void,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const iterator = textStream[Symbol.asyncIterator]()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next()
        if (done) { controller.close(); return }
        controller.enqueue(encoder.encode(value))
      } catch (err) {
        controller.error(err)
      }
    },
    cancel() {
      iterator.return?.()
      onCancel?.()
    },
  })
}

function formatConversation(messages: Message[]): string {
  return messages
    .map(
      message =>
        `${message.role === 'assistant' ? 'Assistant' : 'User'}: ${
          typeof message.content === 'string' ? message.content : ''
        }`
    )
    .join('\n\n')
}

interface ResponsesAgentWithToolsArgs {
  agent: VibeAgent
  messages: Message[]
  context?: string | null
  toolkit: ToolKit
  model: string
  previewToken?: string | null
  onCompletion?: (
    completion: string,
    usage?: { promptTokens: number; completionTokens: number }
  ) => Promise<void> | void
  toolContext?: ToolExecutionContext
  hasFileOverflow?: boolean
  handoffTargetNames?: Record<string, string>
  remainingResponses?: number | null
}

/**
 * Validate tool arguments against the tool's JSON schema parameters.
 * Checks that the args object is present, all required fields exist, and
 * present fields match their declared primitive type.
 * Returns an error string if invalid, null if valid.
 */
function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>,
  schema:
    | { required?: string[]; properties?: Record<string, unknown> }
    | undefined
): string | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return `Tool "${toolName}" received invalid arguments (expected a JSON object).`
  }

  const properties = (schema?.properties ?? {}) as Record<
    string,
    { type?: string }
  >
  const required = schema?.required ?? []

  for (const field of required) {
    if (!(field in args)) {
      return `Tool "${toolName}" missing required argument: "${field}".`
    }
  }

  // Validate types for present fields with a declared primitive type.
  // Catches model hallucinations like duration_minutes: "thirty" when number is expected.
  const primitiveTypes: Record<string, string> = {
    string: 'string',
    number: 'number',
    boolean: 'boolean'
  }
  for (const [field, def] of Object.entries(properties)) {
    if (!(field in args)) continue
    const expectedType = def.type
    if (!expectedType || !(expectedType in primitiveTypes)) continue
    const actualType = typeof args[field]
    if (actualType !== primitiveTypes[expectedType]) {
      return `Tool "${toolName}" argument "${field}" must be a ${expectedType}, got ${actualType}.`
    }
  }

  return null
}

/**
 * Use native OpenAI Responses API tool calling.
 * 1. Call completeText() with tools — the API decides whether to call a tool.
 * 2. If a tool was called, execute it and build a follow-up prompt.
 * 3. Stream the final answer via streamText().
 */
/**
 * Run an agent stream using a tenant-supplied ProviderModelSpec (BYO-LLM path).
 * Uses the Vercel AI SDK chat-completions path so all providers share one interface.
 */
async function runAgentStreamWithSpec({
  agent,
  messages,
  context,
  temperature = 0.1,
  onCompletion,
  toolContext,
  handoffTargetNames,
  remainingResponses,
  spec,
}: Omit<RunAgentStreamArgs, 'previewToken'> & { spec: import('@vibesboard/contracts').ProviderModelSpec }) {
  const agentContext = await buildAgentContext(agent, toolContext)
  let effectiveContext = agentContext.contextText || context || null

  // Google thinking models (gemini-3.5-flash, gemini-2.5-*) require thought_signature
  // to be echoed back in tool responses — unsupported in @ai-sdk/google@0.0.55.
  // For Google provider: pre-load RAG results into context instead of using tool calls.
  const isGoogle = spec.kind === 'google'
  if (isGoogle && agent.fileKeys?.length && agent.retrievalStrategy === 'rag') {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    const query = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : ''
    if (query) {
      try {
        const { searchAgentFileChunks } = await import('./file-search.ts')
        const { matches } = await searchAgentFileChunks({
          tenantId: agent.tenantId ?? '',
          agentId: agent.id,
          query,
          limit: 8,
        })
        if (matches?.length) {
          const ragContext = matches
            .map(m => `[${m.fileName}]\n${m.snippet}`)
            .join('\n\n---\n\n')
          effectiveContext = effectiveContext
            ? `${effectiveContext}\n\n---\n\n${ragContext}`
            : ragContext
        }
      } catch (err) {
        console.error('[runtime] Google RAG pre-load failed:', err)
      }
    }
  }

  const systemPrompt = buildAgentSystemPrompt(agent, effectiveContext, {
    hasFileOverflow: agentContext.hasFileOverflow,
    handoffTargetNames,
    remainingResponses,
  })

  const payload = [
    { role: 'system' as const, content: systemPrompt },
    ...messages.map(m => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: typeof m.content === 'string' ? m.content : '',
    })),
  ]

  // For non-Google providers: pass toolkit as Vercel AI SDK tools so models
  // that support tool calling (Anthropic, OpenAI) can use file_search etc.
  const { tool: aiTool } = await import('ai')
  const { z } = await import('zod')

  const sdkTools: Record<string, any> = {}
  if (!isGoogle) {
    for (const fn of agentContext.toolkit.functions) {
      const executor = agentContext.toolkit.executors[fn.name]
      if (!executor) continue
      sdkTools[fn.name] = aiTool({
        description: fn.description ?? fn.name,
        parameters: z.record(z.unknown()),
        execute: async (args: Record<string, unknown>) => {
          try {
            const result = await executor(args as Record<string, any>, { fileContext: toolContext?.fileContext ?? effectiveContext })
            return typeof result === 'string' ? { result } : result
          } catch (err: any) {
            return { error: err?.message ?? String(err) }
          }
        },
      })
    }
  }

  let disposed = false
  const safeDispose = async () => {
    if (disposed) return
    disposed = true
    await agentContext.dispose()
  }

  // Google provider: @ai-sdk/google@0.0.55 drops text when thinking models
  // (gemini-3.5-flash, gemini-2.5-*) emit thought tokens before text content.
  // Bypass the SDK and call the Gemini REST API directly so we control parsing.
  if (isGoogle) {
    const apiKey = (spec as Extract<import('@vibesboard/contracts').ProviderModelSpec, { kind: 'google' }>).apiKey
    const modelId = spec.modelId
    const geminiMessages = payload
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    const systemInstruction = payload.find(m => m.role === 'system')?.content

    const body: Record<string, unknown> = {
      contents: geminiMessages,
      generationConfig: { temperature },
    }
    if (systemInstruction) body.system_instruction = { parts: [{ text: systemInstruction }] }

    // Use streamGenerateContent so thinking models can think AND produce text.
    // generateContent sometimes produces 0 text when thinking is forced off
    // and the prompt is large (3k+ tokens).
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini API error (${res.status}): ${err}`)
    }

    // Accumulate full text from SSE stream (collect all chunks, then return as one)
    // Gemini thinking models (3.5-flash, 2.5-*) use a two-turn protocol:
    // Turn 1: model generates thought + thoughtSignature (no visible text)
    // Turn 2: echo thoughtSignature back → model generates the actual text response
    const sseReader = res.body!.getReader()
    const sseDecoder = new TextDecoder()

    // Collect turn 1: gather all parts including thoughtSignature
    let turn1Buf = ''
    const turn1Parts: any[] = []
    let promptTokens = 0
    let completionTokens = 0
    while (true) {
      const { done, value } = await sseReader.read()
      if (done) break
      turn1Buf += sseDecoder.decode(value, { stream: true })
      const lines = turn1Buf.split('\n')
      turn1Buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const json = line.slice(6).trim()
        if (!json) continue
        try {
          const chunk = JSON.parse(json)
          const parts = chunk.candidates?.[0]?.content?.parts ?? []
          turn1Parts.push(...parts)
          if (chunk.usageMetadata) {
            promptTokens = chunk.usageMetadata.promptTokenCount ?? 0
            completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0
          }
        } catch {}
      }
    }

    // Check if turn 1 had any real text
    const turn1Text = turn1Parts.filter((p: any) => p.text && !p.thought).map((p: any) => p.text).join('')
    const hasThoughtSig = turn1Parts.some((p: any) => (p as any).thoughtSignature)

    const textIterable = (async function* () {
      let fullText = ''

      if (turn1Text) {
        // Turn 1 already has text — no need for turn 2
        fullText = turn1Text
        yield turn1Text
      } else if (hasThoughtSig) {
        // Turn 2: echo the thought signature back so model produces actual text
        const turn2Body = {
          contents: [
            ...geminiMessages,
            { role: 'model', parts: turn1Parts },                          // model's thinking turn
            { role: 'user', parts: [{ text: '(continue your response)' }] } // nudge for text
          ],
          generationConfig: { temperature },
        }
        if (systemInstruction) (turn2Body as any).system_instruction = { parts: [{ text: systemInstruction }] }

        const res2 = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(turn2Body) }
        )

        if (res2.ok) {
          const reader2 = res2.body!.getReader()
          const dec2 = new TextDecoder()
          let buf2 = ''
          while (true) {
            const { done, value } = await reader2.read()
            if (done) break
            buf2 += dec2.decode(value, { stream: true })
            const lines = buf2.split('\n')
            buf2 = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const json = line.slice(6).trim()
              if (!json) continue
              try {
                const chunk = JSON.parse(json)
                for (const p of (chunk.candidates?.[0]?.content?.parts ?? [])) {
                  if (p.text && !(p as any).thought) { fullText += p.text; yield p.text as string }
                }
              } catch {}
            }
          }
        }
      }

      if (!fullText) {
        // Both turns produced no text — model may be in thinking-only mode.
        // Surface a clear message rather than silently returning empty response.
        const msg = 'I was unable to generate a response. The configured Gemini model appears to be in thinking-only mode with this API key. Please try a different model or provider in Settings → LLM Providers.'
        fullText = msg
        yield msg
      }
      yield `\n<!--CHAT_COMPLETE:${JSON.stringify({ chatComplete: true, reason: null })}-->`
      await safeDispose()
      if (onCompletion) await onCompletion(fullText, { promptTokens, completionTokens })
    })()
    return textStreamToReadable(textIterable, () => safeDispose().catch(() => {}))
  }

  const result = await aiStreamText({
    model: buildProviderModel(spec),
    messages: payload,
    temperature,
    tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
    maxSteps: Object.keys(sdkTools).length > 0 ? 5 : undefined,
    async onFinish({ text, usage }) {
      await safeDispose()
      if (onCompletion) {
        await onCompletion(text, usage ? { promptTokens: usage.promptTokens, completionTokens: usage.completionTokens } : undefined)
      }
    },
  })

  return textStreamToReadable(result.textStream, () => safeDispose().catch(() => {}))
}

const runResponsesAgentWithTools = async ({
  agent,
  messages,
  context,
  toolkit,
  model,
  previewToken,
  onCompletion,
  toolContext,
  hasFileOverflow,
  handoffTargetNames,
  remainingResponses
}: ResponsesAgentWithToolsArgs) => {
  const apiKey = previewToken ?? process.env.OPENAI_API_KEY ?? null
  const systemPrompt = buildAgentSystemPrompt(agent, context, {
    hasFileOverflow,
    handoffTargetNames,
    remainingResponses
  })
  const conversation = formatConversation(messages)

  // Convert toolkit functions to Responses API tool format
  const tools: ResponsesApiTool[] = toolkit.functions.map(fn => ({
    type: 'function' as const,
    name: fn.name,
    description: fn.description ?? 'No description.',
    parameters:
      fn.parameters && Object.keys(fn.parameters).length
        ? fn.parameters
        : { type: 'object', properties: {} }
  }))

  const prompt =
    `${systemPrompt}\n\n` +
    `Conversation so far:\n` +
    (conversation || '(no prior messages).')

  // Step 1: Call with native tools — model decides whether to use a tool
  const decision = await completeText({
    prompt,
    model,
    apiKey,
    tools
  })

  // Track cumulative token usage across decision + final stream
  let totalPromptTokens = decision.usage?.inputTokens ?? 0
  let totalCompletionTokens = decision.usage?.outputTokens ?? 0

  // Step 2: If model chose a tool, execute it
  let toolResult: string | null = null
  let chosenTool: string | null = null
  let toolArgs: Record<string, any> = {}

  if (decision.toolCalls.length > 0) {
    const call = decision.toolCalls[0]
    chosenTool = call.name
    toolArgs = call.arguments ?? {}
    const executor = toolkit.executors[chosenTool]

    if (executor) {
      // Validate args against the tool's JSON schema before execution.
      // Guards against hallucinated or malformed args from the model.
      const toolSchema = tools.find(t => t.name === chosenTool)
      const validationError = validateToolArgs(
        chosenTool,
        toolArgs,
        toolSchema?.parameters
      )
      if (validationError) {
        toolResult = validationError
      } else {
        try {
          toolResult = await executor(toolArgs, {
            fileContext: toolContext?.fileContext ?? context
          })
        } catch (error) {
          toolResult = `Tool ${chosenTool} failed: ${error}`
        }
      }
    }
  }

  // Step 3: Build final prompt and stream the answer
  const finalPromptParts: string[] = [
    systemPrompt,
    '',
    'Conversation so far:',
    conversation || '(no prior messages).'
  ]

  if (chosenTool && toolResult !== null) {
    finalPromptParts.push(
      '',
      `Tool used: ${chosenTool}`,
      `Tool arguments (JSON): ${JSON.stringify(toolArgs)}`,
      'Tool result:',
      toolResult,
      '',
      'Now answer the user based on the tool result. Do not mention internal tool details.'
    )
  } else {
    finalPromptParts.push(
      '',
      'Answer the user directly based on the conversation.'
    )
  }

  const finalPrompt = finalPromptParts.join('\n')

  const stream = await streamText({
    prompt: finalPrompt,
    model,
    apiKey,
    async onDone(completion, usage) {
      totalPromptTokens += usage?.inputTokens ?? 0
      totalCompletionTokens += usage?.outputTokens ?? 0
      if (onCompletion) {
        await onCompletion(completion, {
          promptTokens: totalPromptTokens,
          completionTokens: totalCompletionTokens
        })
      }
    }
  })

  return stream
}
