import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { CockpitBoard } from '@/components/ward/cockpit-board'
import { getCurrentSession } from '@/lib/auth/session'
import { requireWardAccess } from '@/lib/auth/ward-access'
import { env } from '@/lib/env'
import { getCockpit } from '@/lib/ward/cockpit'

export const metadata: Metadata = { title: 'Ward board' }
// Reads live DB state and is mutated by extraction/approvals — never cache.
export const dynamic = 'force-dynamic'

// The dashboard *is* the ward board — the flow cockpit is the app's home.
export default async function DashboardPage() {
  const session = await getCurrentSession()
  if (!session?.user) redirect('/login')

  if (!env.FEATURE_WARD_BOARD) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">WardBeat</h1>
        <p className="text-muted-foreground text-sm">
          The ward board is disabled (set <code>FEATURE_WARD_BOARD=true</code>).
        </p>
      </div>
    )
  }

  // Read-side gate (spec v0.12.0 M3): the board is patient data. A user with
  // no ward role or no ward membership gets a friendly empty state — never
  // the board. `getCockpit` runs the same check, so this page copy is UX,
  // not the enforcement.
  const access = await requireWardAccess('view_board', { any: true })
  if (!access.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Ward board</h1>
        <p className="text-muted-foreground text-sm">
          You have not been assigned to a ward yet. Ask an administrator to
          assign you a clinical role and ward in Settings.
        </p>
      </div>
    )
  }

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
