import { type VibeAgent } from '@vibesboard/contracts'
import {
  BUILTIN_TOOL_FACTORIES,
  createToolKit,
  type ToolExecutionContext,
  type ToolKit
} from './base.ts'
import './builtin'

export const buildToolKit = (
  agent: VibeAgent,
  context: ToolExecutionContext
): ToolKit => {
  return createToolKit(agent, context, BUILTIN_TOOL_FACTORIES)
}

export type { ToolExecutionContext, ToolKit } from './base.ts'
