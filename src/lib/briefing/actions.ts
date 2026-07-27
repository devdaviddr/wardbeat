'use server'

import { getCurrentSession } from '@/lib/auth/session'
import { getFlowBriefing, type FlowBriefing } from './briefing'

/**
 * Async briefing fetch for the board header strip. It's the only NIM call on the
 * cockpit, so the board loads it after render rather than blocking on it.
 */
export async function getBriefingSummaryAction(): Promise<FlowBriefing | null> {
  const session = await getCurrentSession()
  if (!session?.user) return null
  try {
    return await getFlowBriefing()
  } catch {
    return null
  }
}
