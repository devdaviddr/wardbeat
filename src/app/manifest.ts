import type { MetadataRoute } from 'next'

// Served at /manifest.webmanifest and auto-linked by Next.js. Edit name/colors
// and re-run `pnpm gen:icons` after swapping in real branding.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'WardBeat',
    short_name: 'WardBeat',
    description:
      'Keep a hospital ward flowing and beds utilised — AI-enabled ward operations.',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#ffffff',
    theme_color: '#0f172a',
    categories: ['productivity', 'developer'],
    shortcuts: [
      {
        name: 'Dashboard',
        short_name: 'Dashboard',
        url: '/dashboard',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
    ],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
