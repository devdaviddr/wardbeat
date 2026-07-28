'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { cn } from '@/lib/utils'

const TABS = [
  { title: 'Overview', href: '/about' },
  { title: 'Architecture', href: '/about/architecture' },
  { title: 'AI', href: '/about/ai' },
  { title: 'Evals', href: '/about/evals' },
  { title: 'Monitoring', href: '/about/monitoring' },
  { title: 'Azure', href: '/about/azure' },
  { title: 'Demo', href: '/about/demo' },
  { title: 'Workflow', href: '/about/workflow' },
  { title: 'Roadmap', href: '/about/roadmap' },
  { title: 'Glossary', href: '/about/glossary' },
]

export function AboutTabs() {
  const pathname = usePathname()
  return (
    <nav className="border-border flex flex-wrap gap-1 border-b pb-px">
      {TABS.map((tab) => {
        const active = pathname === tab.href
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'rounded-t-md px-4 py-2 text-sm font-medium transition-colors',
              active
                ? 'border-primary text-foreground border-b-2'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {tab.title}
          </Link>
        )
      })}
    </nav>
  )
}
