// lib/agent/actions/appointments/index.ts
import type { ActionModule } from '../types.ts'
import { buildAppointmentsTools } from './tools.ts'

export const AppointmentsModule: ActionModule = {
  type: 'appointments',
  buildTools: buildAppointmentsTools
}
