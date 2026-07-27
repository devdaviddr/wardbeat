'use server'

import { routeQuestion, type CopilotRoute } from '@/lib/ai/client'
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
      error: 'Ask a question first.',
    }
  }

  try {
    const path = await routeQuestion(q)

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
      }
    }

    return {
      ok: true,
      path: 'out_of_scope',
      answer: OUT_OF_SCOPE,
      grounded: false,
      citations: [],
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
      error: message,
    }
  }
}
