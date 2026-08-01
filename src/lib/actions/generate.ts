'use server'

import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { recommendations, type ActionType } from '@/db/schema'
import { recommendActions } from '@/lib/ai/client'
import { describeEmbeddingDrift } from '@/lib/ai/embedding-model'
import { combineProvenance, type Provenance } from '@/lib/ai/provenance'
import { requireWardAccess } from '@/lib/auth/ward-access'
import { retrievePolicy } from '@/lib/copilot/policy'
import { logger } from '@/lib/logger'
import { AI_LIMITS, AI_RATE_LIMIT_MESSAGE, rateLimit } from '@/lib/rate-limit'
import { getWardBoard } from '@/lib/ward/queries'

export interface GenerateSummary {
  ok: boolean
  generated: number
  patients: number
  /** Weakest provenance across the batch, also persisted per row on
   *  `recommendations.provenance` (v0.11.0 M5). */
  provenance: Provenance
  /**
   * Set when the policy vectors these recommendations were retrieved against
   * were built by a different embedding model than the query. The retrieval is
   * meaningless in that state, so it must be said out loud (v0.11.0 FR8).
   */
  embeddingDrift?: string
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
  // Authorization FIRST — a denied caller must not consume rate budget
  // (spec v0.12.0 M3). `{ any: true }` until multi-ward lands (v0.13.0).
  const access = await requireWardAccess('generate_recommendations', {
    any: true,
  })
  if (!access.ok) {
    return {
      ok: false,
      generated: 0,
      patients: 0,
      provenance: 'mock',
      error: access.error,
    }
  }

  // Per-user cap: a run costs ~2 NIM calls per delayed patient — the single
  // most expensive AI action (see AI_LIMITS for the arithmetic).
  const rl = rateLimit(
    `ai:generate:${access.userId}`,
    AI_LIMITS.generate.limit,
    AI_LIMITS.generate.windowMs,
  )
  if (!rl.success) {
    logger.warn('recommendation generation rate limited', {
      userId: access.userId,
      resetAt: rl.resetAt,
    })
    return {
      ok: false,
      generated: 0,
      patients: 0,
      provenance: 'mock',
      error: AI_RATE_LIMIT_MESSAGE,
    }
  }

  try {
    const board = await getWardBoard()
    if (!board)
      return { ok: true, generated: 0, patients: 0, provenance: 'mock' }

    const targets = board.beds.filter(
      (b) => b.occupied && b.mffd && b.encounterId && b.barriers.length > 0,
    )

    let generated = 0
    // null until a call is actually made, so an empty ward is not reported as
    // a successful live run.
    let batched: Provenance | null = null
    let embeddingDrift: string | undefined
    for (const bed of targets) {
      const query = `${bed.barriers.map((b) => b.type).join(' ')} discharge barrier policy`
      const { passages, drift } = await retrievePolicy(query, 6)
      if (drift) {
        // Stop rather than generate. Every "policy-grounded" recommendation
        // from here would cite passages matched across two unrelated vector
        // spaces — worse than generating nothing (v0.11.0 FR8).
        embeddingDrift = describeEmbeddingDrift(drift)
        return {
          ok: false,
          generated,
          patients: targets.length,
          provenance: batched ?? 'mock',
          embeddingDrift,
          error: embeddingDrift,
        }
      }
      const { recommendations: recs, provenance: batchProvenance } =
        await recommendActions(
          `Bed ${bed.label}`,
          bed.barriers.map((b) => ({ id: b.id, type: b.type, quote: b.quote })),
          passages.map((p) => ({ text: p.text, source: p.source })),
        )
      batched = combineProvenance(batched ?? 'live', batchProvenance)

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
          // Persisted per row, not just reported for the run: a recommendation
          // outlives the batch that made it, and the card that renders it a
          // week later has no other way to know a mock wrote it.
          provenance: batchProvenance,
          policyCitation: r.citations
            .map((n) => passages[n - 1])
            .filter(Boolean)
            .map((p) => ({ text: p!.text, source: p!.source })),
        })),
      )
      generated += recs.length
    }

    const provenance: Provenance = batched ?? 'mock'
    revalidatePath('/actions')
    revalidatePath('/ward')
    logger.info('recommendations generated', {
      patients: targets.length,
      generated,
      provenance,
    })
    return { ok: true, generated, patients: targets.length, provenance }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed'
    logger.error('recommendation generation failed', { error: message })
    return {
      ok: false,
      generated: 0,
      patients: 0,
      provenance: 'mock',
      error: message,
    }
  }
}
