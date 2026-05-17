// lib/agent/actions/booking/index.ts
import type { ActionModule } from '../types'
import { buildBookingTools } from './tools'

export const BookingModule: ActionModule = {
  type: 'booking',
  buildTools: buildBookingTools
}
