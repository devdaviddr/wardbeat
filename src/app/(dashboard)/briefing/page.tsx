import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { FlowBriefing } from '@/components/briefing/flow-briefing'
import { getFlowBriefing } from '@/lib/briefing/briefing'
import { getCurrentSession } from '@/lib/auth/session'
import { requireWardAccess } from '@/lib/auth/ward-access'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'
import { AI_LIMITS, AI_RATE_LIMIT_MESSAGE, rateLimit } from '@/lib/rate-limit'

export const metadata: Metadata = { title: 'Flow briefing' }
export const dynamic = 'force-dynamic'

export default async function BriefingPage() {
  if (!env.FEATURE_BRIEFING) notFound()

  const session = await getCurrentSession()
  if (!session?.user) redirect('/login')

  // The briefing narrates ward state — gated like the board, and BEFORE the
  // rate limit so a denied user consumes no budget (spec v0.12.0 M3).
  const access = await requireWardAccess('view_board', { any: true })
  if (!access.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Flow briefing</h1>
        <p className="text-muted-foreground text-sm">
          You have not been assigned to a ward yet. Ask an administrator to
          assign you a clinical role and ward in Settings.
        </p>
      </div>
    )
  }

  // Same per-user bucket as the board-strip action — this page is
  // `force-dynamic`, so a reload loop would otherwise re-run the NIM
  // narration on every request (spec v0.12.0 M5).
  const rl = rateLimit(
    `ai:briefing:${session.user.id}`,
    AI_LIMITS.briefing.limit,
    AI_LIMITS.briefing.windowMs,
  )
  if (!rl.success) {
    logger.warn('briefing rate limited', {
      userId: session.user.id,
      resetAt: rl.resetAt,
      surface: 'briefing_page',
    })
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Flow briefing</h1>
        <p className="text-muted-foreground text-sm">{AI_RATE_LIMIT_MESSAGE}</p>
      </div>
    )
  }

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
