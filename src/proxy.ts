import NextAuth from 'next-auth'
import { NextResponse } from 'next/server'

import { authConfig } from '@/lib/auth/config'

// Next.js 16 renamed the edge "middleware" convention to "proxy". This runs on
// the edge runtime using only the edge-safe config (no DB, no argon2). It does
// three jobs: route protection, role-based access control, and per-request
// Content-Security-Policy.

const { auth } = NextAuth(authConfig)

/** Routes that require an authenticated session. */
const PROTECTED_PREFIXES = ['/dashboard', '/settings', '/ward']
/** Auth pages an already-signed-in user should be bounced away from. */
const AUTH_ROUTES = ['/login', '/register']
/**
 * Optional: gate route prefixes by role at the edge (JWT claim only, no DB).
 * The admin UI here is gated server-side in `/settings`, so this is empty by
 * default. Add entries to protect custom routes; unauthorized users are sent to
 * `/403`. Example:
 *   const ROLE_REQUIRED = { '/admin': ['admin'], '/billing': ['admin', 'member'] }
 */
const ROLE_REQUIRED: Record<string, string[]> = {}

function buildCsp(nonce: string, isDev: boolean): string {
  // Dev needs 'unsafe-eval'/'unsafe-inline' for React Refresh + Turbopack HMR;
  // production locks scripts to a per-request nonce with strict-dynamic.
  const scriptSrc = isDev
    ? `'self' 'unsafe-inline' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}' 'strict-dynamic'`

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`, // Next/Tailwind inject inline styles
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `manifest-src 'self'`,
    `worker-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    isDev ? '' : `upgrade-insecure-requests`,
  ]
    .filter(Boolean)
    .join('; ')
}

export default auth((req) => {
  const { nextUrl } = req
  const { pathname } = nextUrl
  const isLoggedIn = !!req.auth?.user
  // Roles come from the session, populated by the jwt/session callbacks (the
  // JWT carries the role claim, so there's no DB round-trip at the edge).
  const roles = req.auth?.user?.roles ?? []

  // --- Route protection ---
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  if (isProtected && !isLoggedIn) {
    const url = new URL('/login', nextUrl)
    url.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(url)
  }
  if (isLoggedIn && AUTH_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl))
  }

  // --- Role-based access control (JWT only, no DB round-trip) ---
  for (const [prefix, requiredRoles] of Object.entries(ROLE_REQUIRED)) {
    if (pathname.startsWith(prefix)) {
      const hasRole = requiredRoles.some((r) => roles.includes(r))
      if (!hasRole) {
        return NextResponse.redirect(new URL('/403', nextUrl))
      }
    }
  }

  // --- Content-Security-Policy (per-request nonce) ---
  const isDev = process.env.NODE_ENV !== 'production'
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const nonce = btoa(String.fromCharCode(...bytes))
  const csp = buildCsp(nonce, isDev)

  // Setting the CSP on the request headers lets Next.js read the nonce and
  // apply it to its own scripts; we also set it on the response.
  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('content-security-policy', csp)
  return res
})

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)',
  ],
}
