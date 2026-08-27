import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import { cn } from '@vibesboard/utils'
import { LANDING_LINKS } from '@/lib/landing-links'
import { LANDING_OPERATOR } from '@/lib/landing-operator'

interface FooterColumn {
  title: string
  links: { label: string; href: string; external?: boolean }[]
}

const BASE_COLUMNS: FooterColumn[] = [
  {
    title: 'Platform',
    links: [
      { label: 'Quickstart', href: '#quickstart' },
      { label: 'Capabilities', href: '#capabilities' },
      { label: 'Self-host or cloud', href: '#deploy' },
      { label: 'Sign in', href: LANDING_LINKS.signIn }
    ]
  },
  {
    title: 'Docs',
    links: [
      { label: 'All documentation', href: LANDING_LINKS.docs },
      { label: 'Self-hosting', href: LANDING_LINKS.development },
      { label: 'Cloud Run deployment', href: LANDING_LINKS.deployment },
      { label: 'Environment variables', href: LANDING_LINKS.configuration },
      { label: 'Bring your own model', href: LANDING_LINKS.byoLlm },
      { label: 'Security', href: LANDING_LINKS.security }
    ]
  },
  {
    title: 'Project',
    links: [
      { label: 'GitHub', href: LANDING_LINKS.repo, external: true },
      { label: 'Issues', href: LANDING_LINKS.issues, external: true },
      {
        label: 'Good first issues',
        href: LANDING_LINKS.goodFirstIssues,
        external: true
      },
      { label: 'Releases', href: LANDING_LINKS.releases, external: true },
      {
        label: 'Contributors',
        href: LANDING_LINKS.contributors,
        external: true
      },
      { label: 'MIT core license', href: LANDING_LINKS.license, external: true }
    ]
  }
]

/**
 * The "More from us" column exists only when this deployment's operator has
 * something to put in it — sibling products or a contact address. On an
 * unconfigured fork it is omitted entirely rather than rendering the upstream
 * project's links. See lib/landing-operator.ts.
 */
const OPERATOR_LINKS: FooterColumn['links'] = [
  ...LANDING_OPERATOR.siblingProducts,
  ...(LANDING_OPERATOR.contactEmail
    ? [
        {
          label: LANDING_OPERATOR.contactEmail,
          href: `mailto:${LANDING_OPERATOR.contactEmail}`
        }
      ]
    : [])
]

const COLUMNS: FooterColumn[] = OPERATOR_LINKS.length
  ? [...BASE_COLUMNS, { title: 'More from us', links: OPERATOR_LINKS }]
  : BASE_COLUMNS

export function LandingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="safe-area-inset-bottom dark border-t border-white/10 bg-background px-4 py-8 text-foreground sm:px-6 md:py-16">
      <div className="container mx-auto">
        <div
          className={cn(
            'hidden gap-10 md:grid lg:gap-8',
            // Both variants are written out so Tailwind's scanner sees them;
            // an interpolated arbitrary value would not be generated.
            COLUMNS.length === 4
              ? 'lg:grid-cols-[1.4fr_repeat(4,1fr)]'
              : 'lg:grid-cols-[1.4fr_repeat(3,1fr)]'
          )}
        >
          <div className="max-w-sm">
            <span className="font-switzer text-2xl font-bold tracking-[-0.08em]">
              vibesboard
            </span>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              The agent platform you host yourself — agents grounded in your
              data, connected to your tools, and deployed to any channel. Bring
              your own model, keep your data.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {['MIT core', 'Self-hosted'].map(chip => (
                <span
                  key={chip}
                  className="rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
          </div>

          {COLUMNS.map(column => (
            <div key={column.title}>
              <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
                {column.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map(link => (
                  <li key={`${column.title}-${link.label}`}>
                    <Link
                      href={link.href}
                      target={link.external ? '_blank' : undefined}
                      rel={link.external ? 'noopener noreferrer' : undefined}
                      className="group inline-flex items-center gap-1 text-sm text-foreground/80 transition-colors hover:text-primary"
                    >
                      {link.label}
                      {link.external && (
                        <ArrowUpRight
                          className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                          aria-hidden
                        />
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-0 flex flex-col items-center justify-between gap-4 text-xs text-muted-foreground md:mt-12 md:flex-row md:gap-0 md:border-t md:border-white/10 md:pt-6">
          <p className="text-center sm:text-left">
            © {year} Vibesboard · MIT-licensed core · Public beta
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
            {LANDING_OPERATOR.socials.map(social => (
              <Link
                key={social.label}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="transition-colors hover:text-primary"
              >
                {social.label}
              </Link>
            ))}
            <Link
              href={LANDING_LINKS.privacy}
              className="transition-colors hover:text-primary"
            >
              Privacy
            </Link>
            <Link
              href={LANDING_LINKS.terms}
              className="transition-colors hover:text-primary"
            >
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}
