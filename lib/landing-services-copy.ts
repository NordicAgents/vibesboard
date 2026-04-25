export interface LandingServiceItem {
  id: string
  title: string
  description: string
  image: string
  imageAlt: string
}

export const LANDING_SERVICES_HEADING =
  'Built for businesses that win by replying faster.'

export const LANDING_SERVICES_ITEMS: LandingServiceItem[] = [
  {
    id: '01',
    title: 'Reply Before They Bounce',
    description:
      'Answer FAQs, pricing, availability, and policies on WhatsApp and Instagram while intent is still hot.',
    image: '/images/landing/capabilities/reply-before-they-bounce.png',
    imageAlt:
      'VibeAgent capability visual showing automated WhatsApp and Instagram replies'
  },
  {
    id: '02',
    title: 'Capture Every Lead',
    description:
      'Qualify every chat, collect names and needs, and hand your team the context before they step in.',
    image: '/images/landing/capabilities/capture-every-lead.png',
    imageAlt:
      'VibeAgent capability visual showing lead capture from customer conversations'
  },
  {
    id: '03',
    title: 'Book More Appointments',
    description:
      'Confirm slots, send reminders, and follow up when interested customers go quiet.',
    image: '/images/landing/capabilities/book-more-appointments.png',
    imageAlt:
      'VibeAgent capability visual showing appointment booking and reminders'
  },
  {
    id: '04',
    title: 'Know What Customers Want',
    description:
      'See what people ask for, where deals stall, and which answers need improving.',
    image: '/images/landing/capabilities/know-what-customers-want.png',
    imageAlt:
      'VibeAgent capability visual showing conversation analytics and demand insights'
  }
]
