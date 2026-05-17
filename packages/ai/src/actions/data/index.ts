import type { ActionModule } from '../types.ts'
import { buildDataTools } from './tools.ts'

export const DataModule: ActionModule = {
  type: 'data',
  buildTools: buildDataTools
}
