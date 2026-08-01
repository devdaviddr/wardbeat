'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import {
  actionAudit,
  barrierEvents,
  barriers,
  recommendations,
} from '@/db/schema'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { notifyBarrierAssigned } from '@/lib/ward/barrier-notify'

export interface DecisionResult {
  ok: boolean
  error?: string
}

/** Optional delegation applied in the same step as an approval. */
export interface Delegation {
  ownerUserId?: string | null
  dueAt?: Date | null
}

/**
 * Human-in-the-loop decision on a recommendation. The ONLY writes are the
 * recommendation status, the source barrier (status, and any delegation), a
 * barrier lifecycle event, and an audit row attributing the decision — never an
 * external side effect.
 *
 * All of it runs in one transaction with the recommendation row locked. Before
 * v0.10.0 the status check and the three writes were separate statements, so
 * two clinicians approving at the same moment could both pass the guard and
 * write **two audit rows for one decision** — corrupting the clinical audit
 * trail specifically. `SELECT … FOR UPDATE` serialises them; the second now
 * gets a clean "Already approved".
 */
async function decide(
  recommendationId: string,
  decision: 'approved' | 'dismissed',
  note?: string,
  delegation?: Delegation,
): Promise<DecisionResult> {
  const session = await getCurrentSession()
  const actor = session?.user?.id
  if (!actor) return { ok: false, error: 'Unauthorized' }

  try {
    const result = await db.transaction(async (tx) => {
      const [rec] = await tx
        .select()
        .from(recommendations)
        .where(eq(recommendations.id, recommendationId))
        .for('update')

      if (!rec) return { ok: false as const, error: 'Recommendation not found' }
      if (rec.status !== 'proposed') {
        return { ok: false as const, error: `Already ${rec.status}` }
      }

      await tx
        .update(recommendations)
        .set({ status: decision })
        .where(eq(recommendations.id, recommendationId))

      // Approving marks the underlying barrier as being actioned, and — new in
      // v0.10.0 — can hand it to someone in the same step, so approval is
      // delegation rather than a status flip nobody is told about.
      if (decision === 'approved' && rec.barrierId) {
        await tx
          .update(barriers)
          .set({
            status: 'in_progress',
            ...(delegation?.ownerUserId
              ? { ownerUserId: delegation.ownerUserId }
              : {}),
            ...(delegation?.dueAt ? { dueAt: delegation.dueAt } : {}),
          })
          .where(eq(barriers.id, rec.barrierId))

        await tx.insert(barrierEvents).values({
          barrierId: rec.barrierId,
          kind: delegation?.ownerUserId ? 'assigned' : 'commented',
          actorUserId: actor,
          body: delegation?.ownerUserId ? null : `Approved: ${rec.title}`,
          meta: {
            recommendationId,
            ownerUserId: delegation?.ownerUserId ?? null,
            dueAt: delegation?.dueAt?.toISOString() ?? null,
          },
        })
      }

      await tx.insert(actionAudit).values({
        recommendationId,
        decision,
        actorUserId: actor,
        note: note ?? null,
      })

      return { ok: true as const, barrierId: rec.barrierId }
    })

    if (!result.ok) return result

    revalidatePath('/actions')
    revalidatePath('/ward')
    revalidatePath('/dashboard')
    logger.info('recommendation decided', {
      recommendationId,
      decision,
      actor,
      delegated: Boolean(delegation?.ownerUserId),
    })

    if (
      decision === 'approved' &&
      result.barrierId &&
      delegation?.ownerUserId
    ) {
      void notifyBarrierAssigned(result.barrierId, delegation.ownerUserId)
    }

    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Decision failed'
    logger.error('recommendation decision failed', { error: message })
    return { ok: false, error: message }
  }
}

export async function approveRecommendationAction(
  id: string,
  delegation?: Delegation,
): Promise<DecisionResult> {
  return decide(id, 'approved', undefined, delegation)
}

export async function dismissRecommendationAction(
  id: string,
): Promise<DecisionResult> {
  return decide(id, 'dismissed')
}
