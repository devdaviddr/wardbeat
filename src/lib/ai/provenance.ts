/**
 * How an AI output was actually produced. Mirrors `ai/app/provenance.py` — the
 * FastAPI service is the source of truth and stamps every model-backed response.
 *
 * Deliberately not `server-only`: client components need the type and the copy
 * to render the indicator.
 *
 * - `live`     — a real model call succeeded.
 * - `mock`     — NIM_MOCK is on; no live call was attempted.
 * - `fallback` — live was configured, the call failed, and the mock answered.
 */
export const PROVENANCES = ['live', 'mock', 'fallback'] as const

export type Provenance = (typeof PROVENANCES)[number]

/**
 * The only state in which a "grounded" claim can be true: a model has to have
 * read the sources to have grounded anything in them.
 */
export function isModelGenerated(provenance: Provenance | undefined): boolean {
  return provenance === 'live'
}

// Least → most trustworthy is not a total order we need; we only ever need to
// know which of several calls was the weakest link.
const SEVERITY: Record<Provenance, number> = {
  live: 0,
  mock: 1,
  fallback: 2,
}

/**
 * Combine the provenance of every model call that shaped one user-visible
 * answer, taking the weakest. A response whose routing was decided by keyword
 * matching is not fully model-generated even if the prose that followed was.
 */
export function combineProvenance(
  ...values: Array<Provenance | undefined>
): Provenance {
  let worst: Provenance = 'live'
  for (const v of values) {
    if (v && SEVERITY[v] > SEVERITY[worst]) worst = v
  }
  return worst
}

export interface ProvenanceCopy {
  /** Short label for the badge itself. */
  label: string
  /** Longer explanation, used as the title/tooltip. */
  detail: string
}

/**
 * One place for the wording so it cannot drift between the copilot, the dock,
 * the recommendation card and the briefing.
 */
export const PROVENANCE_COPY: Record<Provenance, ProvenanceCopy> = {
  live: {
    label: 'model-generated',
    detail: 'Composed by the language model from the cited sources.',
  },
  mock: {
    label: 'not model-generated',
    detail:
      'Assembled by the offline deterministic mock (NIM_MOCK is on). No model read the sources, so this is not grounded.',
  },
  fallback: {
    label: 'fallback — model unavailable',
    detail:
      'A live model call failed and the deterministic mock answered instead. Treat this as unverified.',
  },
}
