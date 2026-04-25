export type LandingHeroConversationRole = 'customer' | 'agent'

export interface LandingHeroConversationMessage {
  id: string
  role: LandingHeroConversationRole
  text: string
  time: string
}

export const LANDING_HERO_TAGLINE = 'Let your agent talk. Get your time back.'

export const LANDING_HERO_CONVERSATION: LandingHeroConversationMessage[] = [
  {
    id: 'customer-consultation-request',
    role: 'customer',
    text: 'Can I book a consultation tomorrow afternoon?',
    time: '9:41 AM'
  },
  {
    id: 'agent-consultation-slot',
    role: 'agent',
    text: 'Yes - 2:30 PM is open. I can book it and send the confirmation now.',
    time: '9:41 AM'
  },
  {
    id: 'customer-booking-confirm',
    role: 'customer',
    text: 'Book 2:30 for Maya.',
    time: '9:42 AM'
  },
  {
    id: 'agent-booking-confirmation',
    role: 'agent',
    text: 'Booked. Confirmation sent, calendar updated, and the team has the details.',
    time: '9:42 AM'
  }
]
