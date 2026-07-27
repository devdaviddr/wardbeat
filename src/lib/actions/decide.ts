'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { actionAudit, barriers, recommendations } from '@/db/schema'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'

export interface DecisionResult {
  ok: boolean
  error?: string
}

/**
 * Human-in-the-loop decision on a recommendation. The ONLY writes are the
 * recommendation status, the source barrier's status (on approve), and an audit
 * row attributing the decision — never an external side effect.
 */
async function decide(
  recommendationId: string,
  decision: 'approved' | 'dismissed',
  note?: string,
): Promise<DecisionResult> {
  const session = await getCurrentSession()
  if (!session?.user) return { ok: false, error: 'Unauthorized' }

  try {
    const rec = await db.query.recommendations.findFirst({
      where: (r, { eq }) => eq(r.id, recommendationId),
    })
    if (!rec) return { ok: false, error: 'Recommendation not found' }
    if (rec.status !== 'proposed') {
      return { ok: false, error: `Already ${rec.status}` }
    }

    await db
      .update(recommendations)
      .set({ status: decision })
      .where(eq(recommendations.id, recommendationId))

    // Approving marks the underlying barrier as being actioned.
    if (decision === 'approved' && rec.barrierId) {
      await db
        .update(barriers)
        .set({ status: 'in_progress' })
        .where(eq(barriers.id, rec.barrierId))
    }

    await db.insert(actionAudit).values({
      recommendationId,
      decision,
      actorUserId: session.user.id,
      note: note ?? null,
    })

    revalidatePath('/actions')
    revalidatePath('/ward')
    logger.info('recommendation decided', {
      recommendationId,
      decision,
      actor: session.user.id,
    })
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Decision failed'
    logger.error('recommendation decision failed', { error: message })
    return { ok: false, error: message }
  }
}

export async function approveRecommendationAction(
  id: string,
): Promise<DecisionResult> {
  return decide(id, 'approved')
}

export async function dismissRecommendationAction(
  id: string,
): Promise<DecisionResult> {
  return decide(id, 'dismissed')
}
