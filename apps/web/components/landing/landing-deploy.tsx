import Link from 'next/link'
import { ArrowUpRight, Check } from 'lucide-react'

import { cn } from '@vibesboard/utils'
import { Button } from '@/components/ui/button'
import { LANDING_OPERATOR } from '@/lib/landing-operator'
import {
  LANDING_DEPLOY_BODY,
  LANDING_DEPLOY_HEADING,
  landingDeployOptions
} from '@/lib/landing-sections-copy'

import { FadeIn } from './fade-in'
import { LandingSection } from './landing-section'

export function LandingDeploy() {
  // Server component: the operator settings are read from the environment per
  // request, so an image can be re-pointed without a rebuild.
  const options = landingDeployOptions(LANDING_OPERATOR)

  return (
    <LandingSection
      id="deploy"
      label="[06] Deploy"
      heading={LANDING_DEPLOY_HEADING}
      description={LANDING_DEPLOY_BODY}
      contentClassName={cn(
        'grid gap-6',
        options.length > 1 && 'lg:grid-cols-2'
      )}
    >
      {options.map((option, index) => (
        <FadeIn key={option.id} delay={0.08 * index}>
          <div
            className={cn(
              'flex h-full flex-col rounded-3xl border p-6 sm:p-8',
              option.id === 'self-hosted'
                ? 'border-primary/30 bg-primary/[0.04]'
                : 'border-white/10 bg-white/[0.03]'
            )}
          >
            <h3 className="font-switzer text-xl font-medium text-foreground">
              {option.title}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {option.summary}
            </p>

            <ul className="mt-6 flex-1 space-y-3">
              {option.points.map(point => (
                <li key={point} className="flex items-start gap-3 text-sm">
                  <Check
                    className="mt-0.5 size-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  <span className="text-foreground/85">{point}</span>
                </li>
              ))}
            </ul>

            <Button
              className="mt-8 self-start"
              variant={option.id === 'self-hosted' ? 'default' : 'outline'}
              asChild
            >
              <Link
                href={option.cta.href}
                target={option.cta.external ? '_blank' : undefined}
                rel={option.cta.external ? 'noopener noreferrer' : undefined}
              >
                {option.cta.label}
                {option.cta.external && (
                  <ArrowUpRight className="size-4" aria-hidden />
                )}
              </Link>
            </Button>
          </div>
        </FadeIn>
      ))}
    </LandingSection>
  )
}
