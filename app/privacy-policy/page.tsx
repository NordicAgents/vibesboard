import { LandingHeader } from '@/components/landing/landing-header'
import { LandingFooter } from '@/components/landing/landing-footer'

export const metadata = {
  title: 'Privacy Policy - vibesboard',
  description: 'Privacy Policy for vibesboard',
}

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-beige-bg text-black-primary selection:bg-black-primary selection:text-beige-bg dark:bg-background dark:text-foreground dark:selection:bg-white dark:selection:text-black">
      <LandingHeader />
      <div className="container mx-auto px-4 sm:px-6 py-24 sm:py-32">
        <h1 className="text-4xl sm:text-5xl font-bold font-switzer mb-8">Privacy Policy</h1>
        <div className="prose dark:prose-invert max-w-none prose-lg">
          <p className="text-xl text-gray-secondary mb-8">Last updated: {new Date().toLocaleDateString()}</p>

          <h2>1. Introduction</h2>
          <p>
            Welcome to vibesboard. We respect your privacy and are committed to protecting your personal data.
            This privacy policy will inform you as to how we look after your personal data and tell you
            about your privacy rights and how the law protects you.
          </p>

          <h2>2. Data We Collect</h2>
          <p>
            We may collect, use, store and transfer different kinds of personal data about you which we have grouped together follows:
          </p>
          <ul>
            <li>Identity Data</li>
            <li>Contact Data</li>
            <li>Technical Data</li>
            <li>Usage Data</li>
          </ul>

          <h2>3. How We Use Your Data</h2>
          <p>
            We will only use your personal data when the law allows us to. Most commonly, we will use your personal data in the following circumstances:
          </p>
          <ul>
            <li>Where we need to perform the contract we are about to enter into or have entered into with you.</li>
            <li>Where it is necessary for our legitimate interests (or those of a third party) and your interests and fundamental rights do not override those interests.</li>
            <li>Where we need to comply with a legal or regulatory obligation.</li>
          </ul>

          <h2>4. Contact Us</h2>
          <p>
            If you have any questions about this privacy policy or our privacy practices, please contact us at: <a href="mailto:hi@vibesboard.com">hi@vibesboard.com</a>
          </p>
        </div>
      </div>
      <LandingFooter />
    </main>
  )
}
