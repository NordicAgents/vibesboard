'use client'

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  LANDING_QUICKSTART_HEADING,
  LANDING_QUICKSTART_SUBHEADING,
  LANDING_QUICKSTART_TABS
} from '@/lib/landing-quickstart-copy'

import { LandingSection } from './landing-section'
import { TerminalBlock } from './terminal-block'

export function LandingQuickstart() {
  return (
    <LandingSection
      id="quickstart"
      label="[01] Quickstart"
      heading={LANDING_QUICKSTART_HEADING}
      description={LANDING_QUICKSTART_SUBHEADING}
    >
      <Tabs defaultValue={LANDING_QUICKSTART_TABS[0].id}>
        <TabsList className="bg-white/5">
          {LANDING_QUICKSTART_TABS.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="data-[state=active]:bg-white/10"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {LANDING_QUICKSTART_TABS.map(tab => (
          <TabsContent key={tab.id} value={tab.id} className="mt-6">
            {/* minmax(0,…) so the shell block scrolls inside its column
                instead of widening the grid past the viewport. */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-10">
              <TerminalBlock command={tab.command} className="min-w-0" />

              <div className="flex flex-col justify-center gap-4">
                <p className="font-switzer text-lg text-foreground">
                  {tab.description}
                </p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {tab.note}
                </p>
                <Link
                  href={tab.docHref}
                  className="group inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-primary transition-colors hover:text-foreground"
                >
                  {tab.docLabel}
                  <ArrowUpRight
                    className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </div>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </LandingSection>
  )
}
