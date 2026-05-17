import type {
  AgentMode,
  CollectionField,
  QuickSuggestionsMode
} from '@vibesboard/contracts'
import { nanoid } from '@vibesboard/utils'

export interface AgentTemplate {
  id: string
  name: string
  description: string
  icon: 'Headphones' | 'UserPlus' | 'HelpCircle' | 'CalendarDays'
  defaults: {
    instructions: string
    greetingText: string
    mode: AgentMode
    quickSuggestionsMode: QuickSuggestionsMode
    collectionFields?: Omit<CollectionField, 'id'>[]
  }
}

export const AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'customer-support',
    name: 'Customer Support',
    description: 'Answer questions about your product or service',
    icon: 'Headphones',
    defaults: {
      instructions:
        "You are a helpful customer support agent for [Company Name]. Answer questions about our products, services, pricing, and policies. Be friendly and professional. If you don't know the answer, say so and offer to connect them with a human.",
      greetingText: 'Hi there! How can I help you today?',
      mode: 'provider',
      quickSuggestionsMode: 'smart'
    }
  },
  {
    id: 'lead-collector',
    name: 'Lead Collector',
    description: 'Gather contact info and qualifying questions',
    icon: 'UserPlus',
    defaults: {
      instructions:
        "You are a friendly lead qualification agent. Your goal is to collect the visitor's name, email, company, and what they're looking for. Be conversational, not robotic. Ask one question at a time.",
      greetingText:
        "Welcome! I'd love to learn a bit about you so we can help.",
      mode: 'collector',
      quickSuggestionsMode: 'always',
      collectionFields: [
        { label: 'Full Name', type: 'text', required: true, order: 0 },
        { label: 'Email', type: 'email', required: true, order: 1 },
        { label: 'Company', type: 'text', required: false, order: 2 }
      ]
    }
  },
  {
    id: 'faq-bot',
    name: 'FAQ Bot',
    description: 'Answer frequently asked questions with suggestions',
    icon: 'HelpCircle',
    defaults: {
      instructions:
        'You answer frequently asked questions about [Topic]. Keep answers concise (2-3 sentences). Always suggest related questions the user might have.',
      greetingText:
        'Hi! I can answer your questions. What would you like to know?',
      mode: 'provider',
      quickSuggestionsMode: 'always'
    }
  },
  {
    id: 'appointment-booking',
    name: 'Appointment Booking',
    description: 'Collect details needed to schedule a meeting',
    icon: 'CalendarDays',
    defaults: {
      instructions:
        'You help visitors book appointments. Collect their name, email, preferred date/time, and the reason for the meeting. Be warm and efficient. Confirm the details before completing.',
      greetingText:
        "Hi! I can help you schedule an appointment. Let's get started.",
      mode: 'collector',
      quickSuggestionsMode: 'always',
      collectionFields: [
        { label: 'Full Name', type: 'text', required: true, order: 0 },
        { label: 'Email', type: 'email', required: true, order: 1 },
        {
          label: 'Preferred Date',
          type: 'text',
          required: true,
          description: 'Ask for their preferred date and time',
          order: 2
        },
        {
          label: 'Reason for Visit',
          type: 'long_text',
          required: false,
          order: 3
        }
      ]
    }
  }
]

/** Get template defaults with fresh IDs for collection fields */
export function getTemplateDefaults(templateId: string) {
  const template = AGENT_TEMPLATES.find(t => t.id === templateId)
  if (!template) return null

  return {
    instructions: template.defaults.instructions,
    greetingText: template.defaults.greetingText,
    mode: template.defaults.mode,
    quickSuggestionsMode: template.defaults.quickSuggestionsMode,
    collectionFields: template.defaults.collectionFields?.map(f => ({
      ...f,
      id: nanoid()
    }))
  }
}
