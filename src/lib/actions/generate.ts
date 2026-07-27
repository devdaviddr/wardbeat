'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { recommendations, type ActionType } from '@/db/schema'
import { recommendActions } from '@/lib/ai/client'
import { getCurrentSession } from '@/lib/auth/session'
import { retrievePolicy } from '@/lib/copilot/policy'
import { logger } from '@/lib/logger'
import { getWardBoard } from '@/lib/ward/queries'

export interface GenerateSummary {
  ok: boolean
  generated: number
  patients: number
  error?: string
}

const ACTION_TYPES = new Set<ActionType>([
  'chase_tto',
  'book_transport',
  'arrange_social_care',
  'escalate_review',
  'other',
])

/**
 * Generate action recommendations for every MFFD-but-delayed patient: retrieve
 * policy for the patient's barriers (the agent's tool), reason about the
 * next-best action per barrier, and persist as `proposed`. Idempotent — only
 * replaces still-`proposed` recommendations, preserving approved/dismissed history.
 */
export async function generateRecommendationsAction(): Promise<GenerateSummary> {
  const session = await getCurrentSession()
  if (!session?.user) {
    return { ok: false, generated: 0, patients: 0, error: 'Unauthorized' }
  }

  try {
    const board = await getWardBoard()
    if (!board) return { ok: true, generated: 0, patients: 0 }

    const targets = board.beds.filter(
      (b) => b.occupied && b.mffd && b.encounterId && b.barriers.length > 0,
    )

    let generated = 0
    for (const bed of targets) {
      const query = `${bed.barriers.map((b) => b.type).join(' ')} discharge barrier policy`
      const passages = await retrievePolicy(query, 6)
      const recs = await recommendActions(
        `Bed ${bed.label}`,
        bed.barriers.map((b) => ({ id: b.id, type: b.type, quote: b.quote })),
        passages.map((p) => ({ text: p.text, source: p.source })),
      )

      // Idempotent: drop this encounter's still-proposed recs, keep decided ones.
      await db
        .delete(recommendations)
        .where(
          and(
            eq(recommendations.encounterId, bed.encounterId!),
            eq(recommendations.status, 'proposed'),
          ),
        )

      if (recs.length === 0) continue
      await db.insert(recommendations).values(
        recs.map((r) => ({
          encounterId: bed.encounterId!,
          barrierId: r.barrier_id,
          actionType: (ACTION_TYPES.has(r.action_type as ActionType)
            ? r.action_type
            : 'other') as ActionType,
          title: r.title,
          rationale: r.rationale,
          priority: r.priority,
          grounded: r.grounded,
          policyCitation: r.citations
            .map((n) => passages[n - 1])
            .filter(Boolean)
            .map((p) => ({ text: p!.text, source: p!.source })),
        })),
      )
      generated += recs.length
    }

    revalidatePath('/actions')
    revalidatePath('/ward')
    logger.info('recommendations generated', {
      patients: targets.length,
      generated,
    })
    return { ok: true, generated, patients: targets.length }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    logger.error('recommendation generation failed', { error: message })
    return { ok: false, generated: 0, patients: 0, error: message }
  }
}
