import { Metadata, Viewport } from 'next'

import '@/app/globals.css'
import { fontMono, fontSans } from '@/lib/fonts'
import { cn } from '@vibesboard/utils'
import { TailwindIndicator } from '@/components/tailwind-indicator'
import { Providers } from '@/components/providers'
import { Header } from '@/components/header'
import { AppToaster } from '@/components/toaster'
import { auth } from '@/auth'
import { resolveAppUrl } from '@/lib/app-url'
import { getActiveTenantTheme } from '@/lib/tenant-theme'

export const metadata: Metadata = {
  metadataBase: resolveAppUrl(process.env.NEXT_PUBLIC_APP_URL),
  title: {
    default: 'Vibesboard',
    template: `%s — Vibesboard`
  },
  description:
    'An AI-powered conversation agent builder to collect responses from users.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' }
    ],
    shortcut: '/favicon.ico',
    apple: '/apple-touch-icon.png'
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
        <AppToaster />
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
