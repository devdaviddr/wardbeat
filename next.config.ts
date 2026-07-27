import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Pin the workspace root so Next doesn't misdetect it from stray parent-dir
  // lockfiles; also keeps standalone output file-tracing scoped correctly.
  turbopack: {
    root: import.meta.dirname,
  },
  outputFileTracingRoot: import.meta.dirname,
  // Emit a minimal standalone server bundle for small, secure Docker images.
  output: 'standalone',
  // Keep the native argon2 addon out of the bundler so its platform-specific
  // .node binary is resolved from node_modules (and traced into standalone).
  serverExternalPackages: ['@node-rs/argon2'],
  // File uploads go through a Server Action (src/lib/storage/actions.ts) as a
  // multipart body — the 1 MB default is far too small. Matches the app's own
  // UPLOAD_MAX_SIZE_MB ceiling (see src/lib/env.ts); bump both together.
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  // Don't advertise the framework.
  poweredByHeader: false,
  // Fail the production build on type errors instead of silently shipping them.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Harden default response headers for every route.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          {
            // Force HTTPS for two years (browsers ignore this over plain HTTP,
            // so it's safe in local dev). Consider submitting to the preload list.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // The service worker must never be cached, or clients get stuck on an
        // old version. Service-Worker-Allowed widens its controllable scope.
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
