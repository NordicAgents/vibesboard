import { Metadata, Viewport } from 'next'

import { Toaster } from 'react-hot-toast'

import '@/app/globals.css'
import { fontMono, fontSans, fontSwitzer } from '@/lib/fonts'
import { cn } from '@/lib/utils'
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
    { media: '(prefers-color-scheme: light)', color: '#F5F0E8' },
    { media: '(prefers-color-scheme: dark)', color: 'black' }
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500&family=JetBrains+Mono:wght@400;500&display=swap"
        />
      </head>
      <body
        className={cn(
          'font-sans antialiased',
          fontSans.variable,
          fontMono.variable,
          fontSwitzer.variable
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
