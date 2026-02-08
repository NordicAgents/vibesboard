import { Metadata, Viewport } from 'next'

import { Toaster } from 'react-hot-toast'
import { cookies } from 'next/headers'

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
    { media: '(prefers-color-scheme: light)', color: 'white' },
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
  const cookieStore = await cookies()
  const session = await auth({ cookieStore })
  const tenantTheme = session?.user?.id
    ? await getActiveTenantTheme(session.user.id)
    : null

  return (
    <html lang="en" suppressHydrationWarning>
      <head />
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
          <div className="flex min-h-screen flex-col">
            <AppHeaderController>
              {/* @ts-ignore */}
              <Header />
            </AppHeaderController>
            <main className="flex flex-1 flex-col bg-beige-bg dark:bg-background">
              {children}
            </main>
          </div>
          <TailwindIndicator />
        </Providers>
      </body>
    </html>
  )
}
