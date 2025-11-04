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

    return {
      messages: [
        {
          id: nanoid(),
          role: 'function',
          name: call.name,
          content: output
        }
      ],
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
  const payload = {
    model: 'gpt-4o-mini',
    temperature,
    messages: messages.map(message => ({
      role: message.role,
      content: message.content,
      name: message.name,
      function_call: message.function_call
    })),
    functions: functions as any,
    function_call: functions.length ? 'auto' : 'none'
  }

  const response = await openai.createChatCompletion(payload as any)
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

  const assistantMessage: Message = {
    id: nanoid(),
    role: (choice.role ?? 'assistant') as Message['role'],
    content: choice.content ?? '',
    name: choice.name,
    function_call: choice.function_call
  }

  return {
    messages: [assistantMessage],
    pendingFunctionCall: choice.function_call
      ? {
          name: choice.function_call.name,
          arguments: choice.function_call.arguments
        }
      : null
  }
}
