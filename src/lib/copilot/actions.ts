'use server'

import { routeQuestion, type CopilotRoute } from '@/lib/ai/client'
import { combineProvenance, type Provenance } from '@/lib/ai/provenance'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
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
  const session = await getCurrentSession()
  if (!session?.user) {
    return {
      ok: false,
      path: 'error',
      answer: '',
      grounded: false,
      citations: [],
      provenance: 'mock',
      error: 'Unauthorized',
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
