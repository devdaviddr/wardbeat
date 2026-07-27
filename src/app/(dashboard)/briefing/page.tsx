import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { FlowBriefing } from '@/components/briefing/flow-briefing'
import { getFlowBriefing } from '@/lib/briefing/briefing'
import { getCurrentSession } from '@/lib/auth/session'
import { env } from '@/lib/env'

export const metadata: Metadata = { title: 'Flow briefing' }
export const dynamic = 'force-dynamic'

export default async function BriefingPage() {
  if (!env.FEATURE_BRIEFING) notFound()

  const session = await getCurrentSession()
  if (!session?.user) redirect('/login')

  const data = await getFlowBriefing()
  if (!data) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Flow briefing</h1>
        <p className="text-muted-foreground text-sm">
          No ward data yet. Seed with{' '}
          <code className="text-xs">pnpm db:seed:ward</code> and run extraction,
          then reload.
        </p>
      </div>
    )
  }

  return <FlowBriefing data={data} />
}
