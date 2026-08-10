import { LANDING_LINKS } from './landing-links'

export interface LandingQuickstartTab {
  id: string
  label: string
  /** One line on who this path is for. */
  description: string
  /** Shell block, rendered verbatim with a copy button. */
  command: string
  /** The caveat a reader would otherwise hit ten minutes in. */
  note: string
  docHref: string
  docLabel: string
}

export const LANDING_QUICKSTART_HEADING = 'Running in about five minutes.'

export const LANDING_QUICKSTART_SUBHEADING =
  'Every path is the one the maintainers use. Requirements: Bun 1.2.18, Node 22, and Docker with Compose.'

/**
 * The local path is copied verbatim out of the README quickstart, and a test
 * asserts it stays that way — a landing page that drifts from the README is how
 * "it does not work" issues get filed.
 */
export const LANDING_QUICKSTART_TABS: LandingQuickstartTab[] = [
  {
    id: 'local',
    label: 'Local',
    description:
      'Full stack on your machine, with Postgres and MinIO in Docker.',
    command: [
      'git clone https://github.com/NordicAgents/vibeagent.git',
      'cd vibeagent',
      '',
      'cp .env.example .env',
      'bun install',
      'bun run db:setup',
      'bun run dev'
    ].join('\n'),
    note: 'db:setup starts PostgreSQL, Adminer and MinIO, creates the bucket, runs migrations and seeds the database. Fill in .env, then open localhost:3000.',
    docHref: LANDING_LINKS.development,
    docLabel: 'Development guide'
  },
  {
    id: 'docker',
    label: 'Self-host',
    description:
      'The standalone image the project ships, on any host you control.',
    command: [
      'docker build -t vibesboard .',
      'docker run -p 8080:8080 --env-file .env vibesboard'
    ].join('\n'),
    note: 'Bring your own PostgreSQL with pgvector and S3-compatible storage. The container listens on 8080 and runs as a non-root user.',
    docHref: LANDING_LINKS.deployment,
    docLabel: 'Deployment guide'
  }
]
