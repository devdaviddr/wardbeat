'use server'

import { routeQuestion, type CopilotRoute } from '@/lib/ai/client'
import { combineProvenance, type Provenance } from '@/lib/ai/provenance'
import { recordAccess } from '@/lib/audit/record'
import { requireWardAccess } from '@/lib/auth/ward-access'
import { logger } from '@/lib/logger'
import { AI_LIMITS, AI_RATE_LIMIT_MESSAGE, rateLimit } from '@/lib/rate-limit'
import { answerPolicyQuestion } from './policy'
import { answerWardQuestion } from './ward'

export interface CopilotCitation {
  label: string
  detail: string
  kind: 'policy' | 'ward'
  href?: string
}

export interface CopilotResponse {
  ok: boolean
  path: CopilotRoute | 'error'
  answer: string
  grounded: boolean
  citations: CopilotCitation[]
  /** How this answer was produced — the UI must not present it as grounded
   *  unless a model composed it. Weakest link across the calls involved. */
  provenance: Provenance
  /**
   * Set when the stored policy vectors were built by a different embedding
   * model than the one that embedded this question. Policy retrieval is
   * meaningless in that state — both vector spaces are 1024-d so pgvector
   * reports nothing — so the copilot refuses and says why (spec v0.11.0 FR8).
   */
  embeddingDrift?: string
  error?: string
}

const OUT_OF_SCOPE =
  "I can only answer questions about this ward's live state and its discharge policy."

/**
 * Copilot entry point: classify the question, route to the ward-state or policy
 * path, and return a grounded, cited answer. Read-only throughout.
 */
export async function askCopilotAction(
  question: string,
): Promise<CopilotResponse> {
  // Authorization FIRST — a denied caller must not consume rate budget
  // (spec v0.12.0 M3). `{ any: true }` until multi-ward lands (v0.13.0).
  const access = await requireWardAccess('ask_copilot', { any: true })
  if (!access.ok) {
    return {
      ok: false,
      path: 'error',
      answer: '',
      grounded: false,
      citations: [],
      provenance: 'mock',
      error: access.error,
    }
  }
  const q = question.trim()
  if (!q) {
    return {
      ok: false,
      path: 'error',
      answer: '',
      grounded: false,
      citations: [],
      provenance: 'mock',
      error: 'Ask a question first.',
    }
  }

  // Per-user cap: each question fans out into ~3 NIM calls, and the model
  // budget is shared across the ward (see AI_LIMITS for the arithmetic).
  // Checked after the free validations so a blank submit costs no budget.
  const rl = rateLimit(
    `ai:copilot:${access.userId}`,
    AI_LIMITS.copilot.limit,
    AI_LIMITS.copilot.windowMs,
  )
  if (!rl.success) {
    logger.warn('copilot rate limited', {
      userId: access.userId,
      resetAt: rl.resetAt,
    })
    return {
      ok: false,
      path: 'error',
      answer: '',
      grounded: false,
      citations: [],
      provenance: 'mock',
      error: AI_RATE_LIMIT_MESSAGE,
    }
  }

  // The ask is authorized and about to be processed — record who asked what
  // (spec v0.12.0 FR5). Fire-and-forget: never blocks or fails the answer.
  void recordAccess({
    actorUserId: access.userId,
    subjectType: 'copilot_query',
    surface: 'copilot',
    detail: { question: q },
  })

  try {
    const route = await routeQuestion(q)
    const path = route.path

    if (path === 'policy') {
      const r = await answerPolicyQuestion(q)
      return {
        ok: true,
        path,
        answer: r.answer,
        grounded: r.grounded,
        citations: r.citations.map((c) => ({
          label: `${c.docTitle} · ${c.source}`,
          detail: c.text,
          kind: 'policy',
        })),
        provenance: combineProvenance(route.provenance, r.provenance),
        embeddingDrift: r.embeddingDrift,
      }
    }

    if (path === 'ward_state') {
      const r = await answerWardQuestion(q)
      return {
        ok: true,
        path,
        answer: r.answer,
        grounded: r.grounded,
        citations: r.citations.map((label) => ({
          label: `Bed ${label}`,
          detail: '',
          kind: 'ward',
          href: '/ward',
        })),
        provenance: combineProvenance(route.provenance, r.provenance),
      }
    }

    return {
      ok: true,
      path: 'out_of_scope',
      answer: OUT_OF_SCOPE,
      grounded: false,
      citations: [],
      // Canned copy, but the routing decision behind it was a model call.
      provenance: route.provenance,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Copilot failed'
    logger.error('copilot failed', { error: message })
    return {
      ok: false,
      path: 'error',
      answer: '',
      grounded: false,
      citations: [],
      provenance: 'mock',
      error: message,
    }
  }
}
