import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { CockpitBoard } from '@/components/ward/cockpit-board'
import { getCurrentSession } from '@/lib/auth/session'
import { env } from '@/lib/env'
import { getCockpit } from '@/lib/ward/cockpit'

export const metadata: Metadata = { title: 'Ward board' }
// Reads live DB state and is mutated by extraction/approvals — never cache.
export const dynamic = 'force-dynamic'

export default async function WardPage() {
  if (!env.FEATURE_WARD_BOARD) notFound()

  const session = await getCurrentSession()
  if (!session?.user) redirect('/login')

  const cockpit = await getCockpit()
  if (!cockpit) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Ward board</h1>
        <p className="text-muted-foreground text-sm">
          No ward data yet. Seed the synthetic ward with{' '}
          <code className="text-xs">pnpm db:seed:ward</code>, then reload.
        </p>
      </div>
    )
  }

  return <CockpitBoard cockpit={cockpit} />
}
