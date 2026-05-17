// lib/agent/actions/appointments/index.ts
import type { ActionModule } from '../types'
import { buildAppointmentsTools } from './tools'

export const AppointmentsModule: ActionModule = {
  type: 'appointments',
  buildTools: buildAppointmentsTools
}
