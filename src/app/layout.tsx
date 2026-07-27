import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'

import { InstallPrompt } from '@/components/pwa/install-prompt'
import { ServiceWorkerRegister } from '@/components/pwa/service-worker-register'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { env } from '@/lib/env'
import './globals.css'

const APP_NAME = 'WardBeat'
const APP_DESCRIPTION =
  'Keep a hospital ward flowing and beds utilised — AI-enabled ward operations.'

export const metadata: Metadata = {
  // Absolute base for OpenGraph/Twitter image URLs and canonical links.
  metadataBase: new URL(env.APP_URL),
  applicationName: APP_NAME,
  title: {
    default: APP_NAME,
    template: '%s · WardBeat',
  },
  description: APP_DESCRIPTION,
  // Social share cards. The default image (public/og.png) is a committed
  // asset; swap it per fork with no code change. Relative URLs resolve
  // against `metadataBase`.
  openGraph: {
    type: 'website',
    siteName: APP_NAME,
    title: APP_NAME,
    description: APP_DESCRIPTION,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: APP_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_NAME,
    description: APP_DESCRIPTION,
    images: ['/og.png'],
  },
  // iOS home-screen / standalone behaviour.
  appleWebApp: {
    capable: true,
    title: 'WardBeat',
    statusBarStyle: 'default',
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `cover` lets content extend under the notch; safe-area insets are handled
  // in the app shell so nothing is obscured.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The per-request CSP nonce is set on the request headers in `src/proxy.ts`.
  // Thread it into next-themes so its anti-flash inline script runs under the
  // strict production CSP without loosening `script-src`.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <ThemeProvider nonce={nonce}>
          {children}
          <ServiceWorkerRegister />
          <InstallPrompt />
        </ThemeProvider>
      </body>
    </html>
  )
}
