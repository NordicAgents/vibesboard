// lib/agent/actions/booking/index.ts
import type { ActionModule } from '../types.ts'
import { buildBookingTools } from './tools.ts'

export const BookingModule: ActionModule = {
  type: 'booking',
  buildTools: buildBookingTools
}
