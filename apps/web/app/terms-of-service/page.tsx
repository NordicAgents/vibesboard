import { LandingHeader } from '@/components/landing/landing-header'
import { LandingFooter } from '@/components/landing/landing-footer'

export const metadata = {
  title: 'Terms of Service - vibesboard',
  description: 'Terms of Service for vibesboard'
}

export default function TermsOfServicePage() {
  return (
    <main className="dark h-full overflow-y-auto bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
      <LandingHeader />
      <div className="container mx-auto px-4 py-24 sm:px-6 sm:py-32">
        <h1 className="mb-8 font-switzer text-4xl font-bold sm:text-5xl">
          Terms of Service
        </h1>
        <div className="prose prose-lg max-w-none dark:prose-invert">
          <p className="mb-8 text-xl text-gray-secondary">
            Last updated: {new Date().toLocaleDateString()}
          </p>

          <h2>1. Agreement to Terms</h2>
          <p>
            By accessing or using our services, you agree to be bound by these
            Terms of Service and all applicable laws and regulations. If you do
            not agree with any of these terms, you are prohibited from using or
            accessing this site.
          </p>

          <h2>2. Use License</h2>
          <p>
            Permission is granted to temporarily download one copy of the
            materials (information or software) on vibesboard's website for
            personal, non-commercial transitory viewing only. This is the grant
            of a license, not a transfer of title.
          </p>

          <h2>3. Disclaimer</h2>
          <p>
            The materials on vibesboard's website are provided on an 'as is'
            basis. vibesboard makes no warranties, expressed or implied, and
            hereby disclaims and negates all other warranties including, without
            limitation, implied warranties or conditions of merchantability,
            fitness for a particular purpose, or non-infringement of
            intellectual property or other violation of rights.
          </p>

          <h2>4. Limitations</h2>
          <p>
            In no event shall vibesboard or its suppliers be liable for any
            damages (including, without limitation, damages for loss of data or
            profit, or due to business interruption) arising out of the use or
            inability to use the materials on vibesboard's website.
          </p>

          <h2>5. Governing Law</h2>
          <p>
            These terms and conditions are governed by and construed in
            accordance with the laws and you irrevocably submit to the exclusive
            jurisdiction of the courts in that location.
          </p>
        </div>
      </div>
      <LandingFooter />
    </main>
  )
}
