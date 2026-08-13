/**
 * Single source of truth for the docs information architecture.
 *
 * Page content lives in `content/docs/<slug>.mdx`. The slug here is both the
 * URL path segment (`/docs/<slug>`) and the file path, so the two can never
 * drift apart. Order in each section's `pages` array is the sidebar order and
 * the prev/next pager order.
 */

export interface DocNavPage {
  /** URL path and content file path, e.g. `get-started/quickstart`. */
  slug: string
  title: string
  description: string
}

export interface DocNavSection {
  title: string
  pages: DocNavPage[]
}

export const DOCS_INDEX_SLUG: string[] = []

export const DOCS_NAV: DocNavSection[] = [
  {
    title: 'Get started',
    pages: [
      {
        slug: 'get-started/quickstart',
        title: 'Quickstart',
        description:
          'Run Vibesboard locally with Docker Compose in a few minutes.'
      },
      {
        slug: 'get-started/core-concepts',
        title: 'Core concepts',
        description:
          'Workspaces, agents, knowledge, memory, and how they fit together.'
      },
      {
        slug: 'get-started/creating-your-first-agent',
        title: 'Create your first agent',
        description:
          'Build, preview, and publish an agent with the AI-assisted builder.'
      }
    ]
  },
  {
    title: 'Build',
    pages: [
      {
        slug: 'build/knowledge-base-rag',
        title: 'Knowledge base & RAG',
        description:
          'Ground agents in your documents with retrieval-augmented generation.'
      },
      {
        slug: 'build/long-term-memory',
        title: 'Long-term memory',
        description: 'Let agents remember facts across conversations.'
      },
      {
        slug: 'build/hooks-and-lifecycle',
        title: 'Hooks & lifecycle',
        description: 'Run custom logic at points in an agent conversation.'
      },
      {
        slug: 'build/data-actions-and-tools',
        title: 'Data actions & tools',
        description:
          'Connect agents to webhooks, data sources, and external tools.'
      },
      {
        slug: 'build/agent-versioning-and-rollback',
        title: 'Versioning & rollback',
        description:
          'Keep a history of agent configuration and restore an earlier version.'
      }
    ]
  },
  {
    title: 'Deploy',
    pages: [
      {
        slug: 'deploy/web-widget',
        title: 'Web widget',
        description:
          'Embed an agent on your website with the public chat widget.'
      },
      {
        slug: 'deploy/whatsapp',
        title: 'WhatsApp',
        description: 'Connect an agent to a WhatsApp Business number.'
      },
      {
        slug: 'deploy/instagram',
        title: 'Instagram',
        description: 'Connect an agent to Instagram Direct Messages.'
      },
      {
        slug: 'deploy/chatwoot-sync',
        title: 'Chatwoot sync',
        description: 'Sync agent conversations into a Chatwoot inbox.'
      },
      {
        slug: 'deploy/public-links-and-access-gates',
        title: 'Public links & access gates',
        description: 'Share an agent publicly and control who can reach it.'
      }
    ]
  },
  {
    title: 'Integrate',
    pages: [
      {
        slug: 'integrate/google-calendar',
        title: 'Google Calendar',
        description: 'Check availability and book meetings from a conversation.'
      },
      {
        slug: 'integrate/google-sheets',
        title: 'Google Sheets',
        description: 'Read and write spreadsheet data from an agent.'
      },
      {
        slug: 'integrate/webhooks',
        title: 'Webhooks',
        description: 'Call external services and receive events over HTTP.'
      },
      {
        slug: 'integrate/mcp-servers',
        title: 'MCP servers',
        description: 'Connect agents to tools over the Model Context Protocol.'
      }
    ]
  },
  {
    title: 'Self-host',
    pages: [
      {
        slug: 'self-host/docker-compose',
        title: 'Docker Compose',
        description: 'Run the full stack yourself with Postgres and MinIO.'
      },
      {
        slug: 'self-host/cloud-run-deployment',
        title: 'Google Cloud Run',
        description: 'The maintained path for running Vibesboard in production.'
      },
      {
        slug: 'self-host/environment-variables',
        title: 'Environment variables',
        description: 'Every configuration value, grouped by concern.'
      },
      {
        slug: 'self-host/troubleshooting',
        title: 'Troubleshooting',
        description: 'Fixes for the problems people actually hit.'
      }
    ]
  },
  {
    title: 'Platform',
    pages: [
      {
        slug: 'platform/multi-tenancy-and-rls',
        title: 'Multi-tenancy & RLS',
        description:
          'How workspace isolation is enforced at the database layer.'
      },
      {
        slug: 'platform/bring-your-own-llm',
        title: 'Bring your own LLM',
        description: 'Connect any provider and route models per agent or task.'
      },
      {
        slug: 'platform/security-and-credentials',
        title: 'Security & credentials',
        description: 'How secrets, tokens, and outbound requests are handled.'
      }
    ]
  },
  {
    title: 'Contribute',
    pages: [
      {
        slug: 'contribute/architecture',
        title: 'Architecture',
        description: 'How the monorepo, packages, and runtime fit together.'
      },
      {
        slug: 'contribute/testing',
        title: 'Testing',
        description:
          'Unit, integration, and end-to-end tests, and how CI runs them.'
      },
      {
        slug: 'contribute/contributing',
        title: 'Contributing',
        description:
          'Branching, commit conventions, and how to open a pull request.'
      }
    ]
  }
]

export const DOCS_FLAT_PAGES: DocNavPage[] = DOCS_NAV.flatMap(
  section => section.pages
)

export function findDocPage(slug: string): DocNavPage | undefined {
  return DOCS_FLAT_PAGES.find(page => page.slug === slug)
}

export function findAdjacentDocPages(slug: string): {
  prev: DocNavPage | null
  next: DocNavPage | null
} {
  const index = DOCS_FLAT_PAGES.findIndex(page => page.slug === slug)
  if (index === -1) {
    return { prev: null, next: null }
  }
  return {
    prev: index > 0 ? DOCS_FLAT_PAGES[index - 1] : null,
    next: index < DOCS_FLAT_PAGES.length - 1 ? DOCS_FLAT_PAGES[index + 1] : null
  }
}
