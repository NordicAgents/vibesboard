// lib/agent/actions/booking/types.ts
import type { BookableResource } from '@/lib/firestore-types'

export interface BookingConfig {
  mode: 'enquiry' | 'direct'
  resources: BookableResource[]
  eventTitleTemplate: string
  eventTimeMode: 'all-day' | 'timed'
  overlapProtection: boolean
}
