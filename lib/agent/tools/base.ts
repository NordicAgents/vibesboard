import { type AgentToolType, type VibeAgent, type VibeAgentTool } from '@/lib/types'
import { BUILTIN_AGENT_TOOLS } from '@/lib/agents/db'

export interface ToolExecutionContext {
  fileContext?: string | null
}

export interface ToolFunctionDefinition {
  name: string
  description?: string
  parameters: Record<string, any>
}

export interface RegisteredTool {
  function: ToolFunctionDefinition
  execute: ToolExecutor
}

export type ToolExecutor = (
  args: Record<string, any>,
  ctx: ToolExecutionContext
) => Promise<string>

export interface ToolKit {
  functions: ToolFunctionDefinition[]
  executors: Record<string, ToolExecutor>
}

export interface ToolFactoryArgs {
  agent: VibeAgent
  tool: VibeAgentTool
  context: ToolExecutionContext
}

export type ToolFactory = (
  args: ToolFactoryArgs
) => RegisteredTool | null

export const BUILTIN_TOOL_FACTORIES: Record<
  AgentToolType,
  ToolFactory
> = {
  'builtin:web_fetch': () => null,
  'builtin:search': () => null,
  'builtin:file_search': () => null
}

export const registerBuiltinTool = (
  type: Extract<AgentToolType, `builtin:${string}`>,
  factory: ToolFactory
) => {
  BUILTIN_TOOL_FACTORIES[type] = factory
}

export const createToolKit = (
  agent: VibeAgent,
  context: ToolExecutionContext,
  factories: Partial<Record<AgentToolType, ToolFactory>>,
  fallbackFactory?: ToolFactory
): ToolKit => {
  const functions: ToolFunctionDefinition[] = []
  const executors: Record<string, ToolExecutor> = {}

  for (const tool of agent.tools) {
    const factory = factories[tool.type as AgentToolType] ?? fallbackFactory
    if (!factory) continue
    const resolved = factory({ agent, tool, context })
    if (!resolved) continue
    const toolName = resolved.function.name
    functions.push(resolved.function)
    executors[toolName] = resolved.execute
  }

  return {
    functions,
    executors
  }
}

// For OpenAI tool/function names, prefer a safe, stable identifier.
// We intentionally ignore the human-readable `tool.name` (which may contain spaces)
// and use the factory-provided fallback such as `web_search`, `file_search`, etc.
export const resolveToolName = (_tool: VibeAgentTool, fallback: string) => fallback

export const resolveToolDescription = (tool: VibeAgentTool) =>
  tool.description ||
  BUILTIN_AGENT_TOOLS[
    tool.type as keyof typeof BUILTIN_AGENT_TOOLS
  ]?.description ||
  'Custom tool'
