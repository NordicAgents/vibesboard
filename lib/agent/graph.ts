import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import { type Message } from 'ai'
import { nanoid } from '@/lib/utils'
import { OpenAIApi } from 'openai-edge'

import { buildAgentSystemPrompt } from './prompts'
import { type VibeAgent } from '@/lib/types'
import { type ToolExecutor, type ToolFunctionDefinition } from './tools/base'

const AgentState = Annotation.Root({
  messages: Annotation<Message[]>({
    reducer: (state: Message[], update: Message[]) => state.concat(update),
    default: () => []
  }),
  pendingFunctionCall: Annotation<PendingFunctionCall | null>({
    reducer: (_state, update) => update,
    default: () => null
  })
})

export type AgentStateType = typeof AgentState.State

interface PendingFunctionCall {
  name: string
  arguments?: string | null
  // When using OpenAI "tools" (tool_calls), we need to thread the call id back.
  id?: string | null
}

export interface AgentGraphRunArgs {
  openai: OpenAIApi
  agent: VibeAgent
  messages: Message[]
  context?: string | null
  functions: ToolFunctionDefinition[]
  executors: Record<string, ToolExecutor>
  temperature?: number
}

export async function runAgentGraph({
  openai,
  agent,
  context,
  messages,
  functions,
  executors,
  temperature = 0.2
}: AgentGraphRunArgs) {
  let workflow: any = new StateGraph(AgentState as any)

  workflow = workflow.addNode('agent', async (state: AgentStateType) => {
    const response = await callOpenAi({
      openai,
      messages: state.messages,
      functions,
      temperature
    })

    return response
  })

  workflow = workflow.addNode('tools', async (state: AgentStateType) => {
    const call = state.pendingFunctionCall
    if (!call) {
      return {
        pendingFunctionCall: null
      }
    }

    const executor = executors[call.name]
    if (!executor) {
      return {
        messages: [
          {
            id: nanoid(),
            role: 'function',
            name: call.name,
            content: `Tool ${call.name} is not enabled for this agent.`
          }
        ],
        pendingFunctionCall: null
      }
    }

    let parsed: Record<string, any> = {}
    try {
      parsed = call.arguments ? JSON.parse(call.arguments) : {}
    } catch (error) {
      return {
        messages: [
          {
            id: nanoid(),
            role: 'function',
            name: call.name,
            content: `Failed to parse tool arguments: ${error}`
          }
        ],
        pendingFunctionCall: null
      }
    }

    const output = await executor(parsed, {
      fileContext: context
    })

    // If we have a tool_call id (new OpenAI tools API), return a tool role message.
    // Otherwise, fall back to legacy function role message.
    const toolMessage: any = call.id
      ? {
          id: nanoid(),
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: output
        }
      : {
          id: nanoid(),
          role: 'function',
          name: call.name,
          content: output
        }

    return {
      messages: [toolMessage],
      pendingFunctionCall: null
    }
  })

  workflow = workflow.addEdge(START, 'agent')
  workflow = workflow.addEdge('tools', 'agent')
  workflow = workflow.addConditionalEdges('agent', (state: AgentStateType) =>
    state.pendingFunctionCall ? 'tools' : END
  )

  const graph = workflow.compile()
  const initialMessages = prependSystemMessage(agent, context, messages)
  const result = await graph.invoke({
    messages: initialMessages,
    pendingFunctionCall: null
  })
  return result.messages
}

const prependSystemMessage = (
  agent: VibeAgent,
  context: string | null | undefined,
  messages: Message[]
) => {
  const systemPrompt = buildAgentSystemPrompt(agent, context)
  const systemMessage: Message = {
    id: nanoid(),
    role: 'system',
    content: systemPrompt
  }
  const withoutSystem = messages.filter(message => message.role !== 'system')
  return [systemMessage, ...withoutSystem]
}

interface OpenAiCallArgs {
  openai: OpenAIApi
  messages: Message[]
  functions: ToolFunctionDefinition[]
  temperature: number
}

const callOpenAi = async ({
  openai,
  messages,
  functions,
  temperature
}: OpenAiCallArgs) => {
  // Preserve custom fields like tool_call_id on messages if present.
  const outboundMessages = messages.map((message: any) => {
    const base: any = {
      role: message.role,
      content: message.content
    }
    if (message.name) base.name = message.name
    if (message.function_call) base.function_call = message.function_call
    if (message.tool_call_id) base.tool_call_id = message.tool_call_id
    return base
  })

  const payload: any = {
    model: 'gpt-4o-mini',
    temperature,
    messages: outboundMessages,
    // Provide both to maximize compatibility across model versions
    functions: functions as any,
    function_call: functions.length ? 'auto' : 'none'
  }

  const response = await openai.createChatCompletion(payload)
  const json = await response.json()
  const choice = json?.choices?.[0]?.message

  if (!choice) {
    return {
      messages: [
        {
          id: nanoid(),
          role: 'assistant',
          content: 'The model did not return a response.'
        }
      ],
      pendingFunctionCall: null
    }
  }

  // Build assistant message for transcript
  const assistantMessage: any = {
    id: nanoid(),
    role: choice.role ?? 'assistant',
    content: choice.content ?? ''
  }
  if (choice.name) assistantMessage.name = choice.name
  if (choice.function_call) assistantMessage.function_call = choice.function_call
  if (choice.tool_calls) assistantMessage.tool_calls = choice.tool_calls

  // Detect either legacy function_call or new tool_calls
  let pending: PendingFunctionCall | null = null
  if (choice.tool_calls?.length) {
    const toolCall = choice.tool_calls[0]
    const fn = toolCall.function
    pending = {
      id: toolCall.id,
      name: fn?.name ?? '',
      arguments: typeof fn?.arguments === 'string' ? fn.arguments : JSON.stringify(fn?.arguments ?? {})
    }
  } else if (choice.function_call) {
    pending = {
      name: choice.function_call.name,
      arguments: choice.function_call.arguments
    }
  }

  return {
    messages: [assistantMessage as Message],
    pendingFunctionCall: pending
  }
}
