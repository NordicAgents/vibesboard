import type { ActionModule } from '../types'
import { buildDataTools } from './tools'

export const DataModule: ActionModule = {
  type: 'data',
  buildTools: buildDataTools
}
