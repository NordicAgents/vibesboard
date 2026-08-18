import { LANDING_LINKS } from './landing-links'

/* ── [02] Why Vibesboard ──────────────────────────────────────
   Lifted from the README comparison table: the operational work that starts
   after the chatbot demo is over. */

export interface LandingWhyItem {
  need: string
  answer: string
}

export const LANDING_WHY_HEADING =
  'Plenty of tools demo a chatbot. This one is built for the week after the demo.'

export const LANDING_WHY_ITEMS: LandingWhyItem[] = [
  {
    need: 'More than a chat playground',
    answer:
      'A streaming runtime with tools, lifecycle hooks, public deployment, access gates, configuration history and rollback.'
  },
  {
    need: 'Agents where customers already are',
    answer:
      'An embeddable web agent, WhatsApp and Instagram channels with an inbox for each, and Chatwoot sync.'
  },
  {
    need: 'Answers that lead to outcomes',
    answer:
      'RAG and long-term memory wired to Google Calendar, Google Sheets, webhooks and data actions.'
  },
  {
    need: 'One deployment for many teams or clients',
    answer:
      'Workspaces, memberships, plans, feature flags and PostgreSQL row-level security.'
  },
  {
    need: 'Freedom from model lock-in',
    answer:
      'OpenAI, Anthropic, Google Gemini, NVIDIA and OpenAI-compatible providers, routed per agent or per task.'
  },
  {
    need: 'Control of data and inference spend',
    answer:
      'A self-hosted application, your own PostgreSQL and S3-compatible storage, encrypted tenant credentials.'
  }
]

/* ── [03] Channels ─────────────────────────────────────────── */

export const LANDING_CHANNELS_HEADING =
  'Your agent answers in the thread. Your team takes over in one tap.'

export const LANDING_CHANNELS_BODY =
  'Web chat, WhatsApp and Instagram land in a single inbox with the conversation history the agent already has. Nothing about handing a conversation to a human is a workaround.'

export const LANDING_CHANNELS_POINTS = [
  {
    title: 'Auto-reply with receipts',
    body: 'The agent answers in the live thread with delivery and read status, not from a parallel dashboard.'
  },
  {
    title: 'Pause the agent, mid-conversation',
    body: 'One tap hands the thread to a human and holds the agent back until it is resumed.'
  },
  {
    title: 'Messaging rules handled',
    body: 'The WhatsApp 24-hour messaging window is tracked in the header so nobody guesses when a template is required.'
  },
  {
    title: 'Chatwoot sync',
    body: 'Already running a helpdesk? Conversations sync instead of being replaced.'
  }
]

/* ── [04] Capabilities ─────────────────────────────────────── */

export type LandingCapabilityIcon =
  | 'knowledge'
  | 'channels'
  | 'tools'
  | 'scheduling'
  | 'models'
  | 'tenancy'
  | 'hooks'
  | 'sharing'

export interface LandingCapability {
  icon: LandingCapabilityIcon
  title: string
  body: string
}

export const LANDING_CAPABILITIES_HEADING =
  'The parts teams normally stitch together, already in one control plane.'

export const LANDING_CAPABILITIES: LandingCapability[] = [
  {
    icon: 'knowledge',
    title: 'Knowledge & memory',
    body: 'Documents chunked into pgvector for retrieval, plus long-term memory that survives the conversation.'
  },
  {
    icon: 'channels',
    title: 'Channels & inbox',
    body: 'An embeddable web agent, WhatsApp and Instagram, Chatwoot sync, and one inbox for all of it.'
  },
  {
    icon: 'tools',
    title: 'Tools & actions',
    body: 'Webhooks, Google Sheets and data actions — real calls, not canned answers.'
  },
  {
    icon: 'scheduling',
    title: 'Scheduling',
    body: 'Google Calendar availability and booking, so an answer can end in a confirmed slot.'
  },
  {
    icon: 'models',
    title: 'Model routing',
    body: 'OpenAI, Anthropic, Gemini, NVIDIA or any OpenAI-compatible endpoint, chosen per agent or task.'
  },
  {
    icon: 'tenancy',
    title: 'Multi-tenancy',
    body: 'Workspaces, memberships, plans and feature flags over PostgreSQL row-level security.'
  },
  {
    icon: 'hooks',
    title: 'Hooks & versioning',
    body: 'Lifecycle hooks around every run, with configuration history and rollback when a change misfires.'
  },
  {
    icon: 'sharing',
    title: 'Sharing & access gates',
    body: 'A public link and QR code per agent, with an optional password gate whose hash never crosses the API boundary.'
  }
]

/* ── [05] Models ───────────────────────────────────────────── */

export const LANDING_MODELS_HEADING = 'Bring your own model, and your own bill.'

export const LANDING_MODELS_BODY =
  'Workspaces store their own encrypted provider credentials and route by agent or task. The platform key is only a fallback — swapping providers is configuration, not a migration.'

export const LANDING_MODEL_PROVIDERS = [
  'OpenAI',
  'Anthropic',
  'Google Gemini',
  'NVIDIA',
  'OpenAI-compatible'
]

/* ── [06] Self-host or hosted ──────────────────────────────── */

export interface LandingDeployOption {
  id: string
  title: string
  summary: string
  points: string[]
  cta: { label: string; href: string; external?: boolean }
}

export const LANDING_DEPLOY_HEADING = 'Run it yourself, or let us run it.'

export const LANDING_DEPLOY_BODY =
  'Same codebase either way. Self-hosting is the whole product under the MIT license — there is no feature held back to make the hosted plan look better.'

export const LANDING_DEPLOY_OPTIONS: LandingDeployOption[] = [
  {
    id: 'self-hosted',
    title: 'Self-hosted',
    summary: 'Your infrastructure, your data, your provider keys.',
    points: [
      'MIT licensed, the complete platform',
      'Your PostgreSQL with pgvector and your S3-compatible storage',
      'Bring your own model provider credentials',
      'No seat limits and no usage ceiling but your own',
      'You operate upgrades, backups and uptime'
    ],
    cta: {
      label: 'Read the deployment guide',
      href: LANDING_LINKS.deployment
    }
  },
  {
    id: 'hosted',
    title: 'Hosted',
    summary: 'The same build, operated for you on vibesboard.com.',
    points: [
      'Nothing to provision — sign in and create an agent',
      'Managed PostgreSQL, storage, upgrades and backups',
      'Platform model credentials included, or bring your own',
      'Workspace plans and feature flags',
      'Export and self-host later if you change your mind'
    ],
    cta: { label: 'Sign in', href: LANDING_LINKS.signIn }
  }
]

/* ── [07] Security ─────────────────────────────────────────── */

export const LANDING_SECURITY_HEADING =
  'Multi-tenant isolation you can point at in the schema.'

export const LANDING_SECURITY_POINTS = [
  {
    title: 'Row-level security that fails closed',
    body: 'Tenant-scoped queries run with workspace context. Miss the context and the query returns nothing — not everything.'
  },
  {
    title: 'Encrypted tenant credentials',
    body: 'Provider keys and integration secrets are encrypted per workspace, never shared across tenants.'
  },
  {
    title: 'Your storage, your retention',
    body: 'Documents and uploads live in your own S3-compatible bucket under your retention rules.'
  },
  {
    title: 'Audited on every pull request',
    body: 'Semgrep SAST, Trivy dependency scanning and complexity gates run in CI on every change.'
  }
]

/* ── [08] Community ────────────────────────────────────────── */

/** The closing clip already says "Let your agent talk" — don't say it twice. */
export const LANDING_COMMUNITY_HEADING = 'Built in the open.'

export const LANDING_COMMUNITY_BODY =
  'Vibesboard is MIT licensed and developed in the open. Read the code, file what is broken, or take a first issue.'

export const LANDING_COMMUNITY_ACTIONS = [
  { label: 'Star the repo', href: LANDING_LINKS.repo, primary: true },
  { label: 'Browse open issues', href: LANDING_LINKS.issues },
  { label: 'Good first issues', href: LANDING_LINKS.goodFirstIssues }
]
