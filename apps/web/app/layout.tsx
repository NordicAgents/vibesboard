import { Metadata, Viewport } from 'next'

import { Toaster } from 'react-hot-toast'

import '@/app/globals.css'
import { fontMono, fontSans } from '@/lib/fonts'
import { cn } from '@vibesboard/utils'
import { TailwindIndicator } from '@/components/tailwind-indicator'
import { Providers } from '@/components/providers'
import { Header } from '@/components/header'
import { auth } from '@/auth'
import { getActiveTenantTheme } from '@/lib/tenant-theme'

export const metadata: Metadata = {
  title: {
    default: 'vibesboard agent',
    template: `%s - vibesboard -conversation agent builder`
  },
  description:
    'An AI-powered conversation agent builder to collect responses from users.',
  icons: {
    icon: '/logo_1.png',
    shortcut: '/logo_1.png',
    apple: '/logo_1.png'
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f7f5' },
    { media: '(prefers-color-scheme: dark)', color: '#111918' }
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover'
}

interface RootLayoutProps {
  children: React.ReactNode
}

import { AppHeaderController } from '@/components/app-header-controller'

export default async function RootLayout({ children }: RootLayoutProps) {
  const session = await auth()
  const tenantTheme = session?.user?.id
    ? await getActiveTenantTheme(session.user.id)
    : null

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={cn(
          'font-sans antialiased',
          fontSans.variable,
          fontMono.variable
        )}
        style={tenantTheme?.cssVars as any}
        data-tenant-id={tenantTheme?.tenantId}
      >
        <Toaster />
        <Providers attribute="class" defaultTheme="system" enableSystem>
          <div className="flex h-dvh flex-col overflow-hidden">
            <AppHeaderController>
              {/* @ts-ignore */}
              <Header />
            </AppHeaderController>
            <main className="flex min-h-0 flex-1 flex-col bg-beige-bg dark:bg-background">
              {children}
            </main>
          </div>
          <TailwindIndicator />
        </Providers>
      </body>
    </html>
  )
}
