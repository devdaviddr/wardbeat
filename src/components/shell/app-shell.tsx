'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Menu, X } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { SidebarNav } from '@/components/shell/sidebar-nav'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { cn } from '@/lib/utils'

const BRAND = 'WardBeat'

function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

/**
 * Brand lockup: the app icon (same mark as the favicon/PWA icon) next to the
 * wordmark. The icon is decorative here (`alt=""`) since the adjacent text
 * already names the app, so screen readers don't announce it twice.
 */
function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Image
        src="/icon-192.png"
        alt=""
        width={24}
        height={24}
        className="size-6 rounded-md"
      />
      {BRAND}
    </span>
  )
}

/**
 * Minimal, borderless app shell: a fixed sidebar on desktop that collapses to
 * an accessible off-canvas drawer on mobile, plus a sticky topbar. Handles PWA
 * safe-area insets so nothing is obscured by a notch in standalone mode.
 */
export function AppShell({
  user,
  children,
}: {
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  const [lastPathname, setLastPathname] = useState(pathname)
  // `user` is a snapshot from the server component that rendered this shell
  // — it never changes on its own. `useSession()` shares the same
  // SessionProvider context that a profile-photo upload calls `update()`
  // on, so prefer its live value once hydrated (falls back to the snapshot
  // before that, e.g. the very first paint).
  const { data: liveSession } = useSession()
  const avatarImage = liveSession?.user?.image ?? user.image

  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const drawerRef = useRef<HTMLElement>(null)

  // Close the drawer on navigation by adjusting state during render (the
  // React-recommended alternative to a setState-in-effect).
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    setOpen(false)
  }

  // Drawer: lock scroll, trap focus, close on Escape, and restore focus.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (!open) return

    // Capture the trigger now so cleanup restores focus to a stable node.
    const trigger = menuButtonRef.current
    closeButtonRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !drawerRef.current) return
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      document.removeEventListener('keydown', onKeyDown)
      trigger?.focus()
    }
  }, [open])

  return (
    <div className="min-h-dvh">
      <a
        href="#main-content"
        className="focus:bg-background sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[60] focus:rounded-md focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="bg-muted/30 fixed inset-y-0 left-0 z-30 hidden w-60 flex-col px-3 pt-[calc(env(safe-area-inset-top)_+_1rem)] pb-[env(safe-area-inset-bottom)] md:flex">
        <div className="px-2 pb-4">
          <Brand className="text-lg font-semibold tracking-tight" />
        </div>
        <SidebarNav />
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          'fixed inset-0 z-50 md:hidden',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!open}
      >
        <div
          onClick={() => setOpen(false)}
          className={cn(
            'absolute inset-0 bg-black/40 transition-opacity duration-200',
            open ? 'opacity-100' : 'opacity-0',
          )}
        />
        <aside
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Main navigation"
          className={cn(
            'bg-background absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col px-3 pt-[calc(env(safe-area-inset-top)_+_1rem)] pb-[env(safe-area-inset-bottom)] shadow-xl transition-transform duration-200 ease-out',
            open ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between px-2 pb-4">
            <Brand className="text-lg font-semibold tracking-tight" />
            <button
              ref={closeButtonRef}
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </div>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </aside>
      </div>

      {/* Main column */}
      <div className="flex min-h-dvh flex-col md:pl-60">
        <header className="bg-background/80 sticky top-0 z-20 pt-[env(safe-area-inset-top)] backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <button
              ref={menuButtonRef}
              aria-label="Open menu"
              aria-expanded={open}
              onClick={() => setOpen(true)}
              className="text-muted-foreground hover:text-foreground -ml-1 p-1 md:hidden"
            >
              <Menu className="size-5" />
            </button>
            <Brand className="font-semibold md:hidden" />
            <div className="ml-auto flex items-center gap-3">
              <ThemeToggle />
              <span className="text-muted-foreground hidden max-w-[40vw] truncate text-sm sm:inline">
                {user.email}
              </span>
              <Avatar className="size-8">
                {avatarImage && (
                  <AvatarImage src={avatarImage} alt={user.name ?? ''} />
                )}
                {/* Delay the fallback when a photo is expected so a cached
                    load doesn't flash initials first (see avatar-upload). */}
                <AvatarFallback
                  delayMs={avatarImage ? 500 : 0}
                  className="text-xs"
                >
                  {initials(user.name)}
                </AvatarFallback>
              </Avatar>
              <SignOutButton />
            </div>
          </div>
        </header>

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 px-4 py-6 pb-[calc(env(safe-area-inset-bottom)_+_1.5rem)] outline-none sm:px-6"
        >
          {/* Wide content container — the ward cockpit uses the full width; the
              narrower pages (copilot, briefing, actions, settings) self-constrain. */}
          <div className="mx-auto w-full max-w-[1536px]">{children}</div>
        </main>
      </div>
    </div>
  )
}
