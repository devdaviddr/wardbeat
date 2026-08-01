'use server'

import { requireWardAccess } from '@/lib/auth/ward-access'
import { logger } from '@/lib/logger'
import { AI_LIMITS, AI_RATE_LIMIT_MESSAGE, rateLimit } from '@/lib/rate-limit'
import { getFlowBriefing, type FlowBriefing } from './briefing'

/**
 * Result shape for the briefing action. Expected failures (signed out, rate
 * limited, upstream error) are returned, never thrown — Next.js redacts thrown
 * messages in production (CLAUDE.md). `briefing: null` on the ok path means
 * "no ward seeded", which is not an error.
 */
export type BriefingResult =
  { ok: true; briefing: FlowBriefing | null } | { ok: false; error: string }

/**
 * Async briefing fetch for the board header strip. It's the only NIM call on the
 * cockpit, so the board loads it after render rather than blocking on it.
 */
export async function getBriefingSummaryAction(): Promise<BriefingResult> {
  // The briefing narrates ward state, so it is gated like the board — and
  // authorization comes FIRST so a denied caller consumes no rate budget
  // (spec v0.12.0 M3). `{ any: true }` until multi-ward lands (v0.13.0).
  const access = await requireWardAccess('view_board', { any: true })
  if (!access.ok) return { ok: false, error: access.error }

  // Per-user cap: each generate is ≤2 NIM calls out of the shared model
  // budget (see AI_LIMITS for the arithmetic).
  const rl = rateLimit(
    `ai:briefing:${access.userId}`,
    AI_LIMITS.briefing.limit,
    AI_LIMITS.briefing.windowMs,
  )
  if (!rl.success) {
    logger.warn('briefing rate limited', {
      userId: access.userId,
      resetAt: rl.resetAt,
    })
    return { ok: false, error: AI_RATE_LIMIT_MESSAGE }
  }

  try {
    return { ok: true, briefing: await getFlowBriefing() }
  } catch {
    return { ok: false, error: "Couldn't generate the briefing." }
  }
}
