import 'server-only'

import { z } from 'zod'

import { PROVENANCES, type Provenance } from '@/lib/ai/provenance'
import { env } from '@/lib/env'

/**
 * Server-side client for the internal FastAPI `ai` service (barrier extraction).
 * Never import this into a client component — the service token must not reach
 * the browser. The response is Zod-validated at this boundary (the Python side
 * is the source of truth for the shape via its OpenAPI contract).
 */

/**
 * The provenance envelope every model-backed route returns. Parsed rather than
 * cast: if the service ever stops sending it, that must fail loudly here rather
 * than silently render as a trustworthy answer.
 */
const provenanceEnvelope = {
  provenance: z.enum(PROVENANCES),
  model_used: z.string().nullable().default(null),
}

export type { Provenance }

const barrierSchema = z.object({
  type: z.enum(['tto', 'transport', 'social_care', 'review', 'other']),
  status: z.enum(['pending', 'in_progress', 'cleared']).default('pending'),
  source: z.object({
    start: z.number().int().nullable().optional(),
    end: z.number().int().nullable().optional(),
    quote: z.string(),
  }),
  confidence: z.number().int().min(0).max(100).default(80),
})

const extractionResultSchema = z.object({
  ...provenanceEnvelope,
  note_id: z.string(),
  model: z.string(),
  edd: z.string().nullable().optional(),
  mffd_flag: z.boolean(),
  barriers: z.array(barrierSchema),
  escalations: z.array(z.string()).default([]),
  grounded: z.boolean(),
})

export type ExtractionResult = z.infer<typeof extractionResultSchema>
export type ExtractedBarrier = z.infer<typeof barrierSchema>

/**
 * Per-request timeout for AI-service calls. The `ai` service caps each NIM call
 * at ~30s and always falls back to its deterministic mock, so `/extract` never
 * legitimately runs longer than that — this bound exists to break a genuinely
 * stalled connection (unreachable service, half-open socket) rather than let a
 * fetch hang forever and take the whole batch / request down with it.
 */
const AI_REQUEST_TIMEOUT_MS = 45_000

/** Low-level POST to the internal AI service with the service token + timeout. */
async function aiPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${env.WARDBEAT_AI_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.WARDBEAT_AI_SERVICE_TOKEN
          ? { 'x-service-token': env.WARDBEAT_AI_SERVICE_TOKEN }
          : {}),
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new Error(
        `AI service ${path} timed out after ${AI_REQUEST_TIMEOUT_MS}ms`,
      )
    }
    throw err
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`AI service ${path} ${res.status}: ${detail.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

export async function extractNote(input: {
  noteId: string
  encounterId?: string
  text: string
}): Promise<ExtractionResult> {
  const json = await aiPost<unknown>('/extract', {
    note_id: input.noteId,
    encounter_id: input.encounterId ?? null,
    text: input.text,
  })
  return extractionResultSchema.parse(json)
}

export interface EmbedResult {
  vector: number[]
  /**
   * The model that actually produced the vector — `'mock'` when the AI plane is
   * running its deterministic mock. Returned rather than assumed because it is
   * the only thing that distinguishes a hash-derived vector from a real one
   * (spec v0.11.0 FR8); both are 1024-d and pgvector compares them happily.
   */
  model: string
}

export async function embedText(
  text: string,
  inputType: 'query' | 'passage' = 'query',
): Promise<EmbedResult> {
  const res = await aiPost<{ embeddings: number[][]; model?: string }>(
    '/embed',
    { texts: [text], input_type: inputType },
  )
  const vector = res.embeddings[0]
  if (!vector) throw new Error('AI service returned no embedding')
  if (!res.model) {
    throw new Error(
      'AI service /embed returned no model id — embedding drift cannot be detected',
    )
  }
  return { vector, model: res.model }
}

export async function rerankPassages(
  query: string,
  passages: string[],
  topN: number,
): Promise<{ order: number[]; reranked: boolean }> {
  return aiPost('/copilot/rerank', { query, passages, top_n: topN })
}

export interface AnswerPassage {
  id: string
  text: string
  source: string
}

const answerSchema = z.object({
  ...provenanceEnvelope,
  answer: z.string(),
  citations: z.array(z.string()),
  grounded: z.boolean(),
})

export type AnswerResult = z.infer<typeof answerSchema>

export async function answerFromPassages(
  question: string,
  passages: AnswerPassage[],
  kind: 'policy' | 'ward' = 'policy',
): Promise<AnswerResult> {
  const json = await aiPost<unknown>('/copilot/answer', {
    question,
    passages,
    kind,
  })
  return answerSchema.parse(json)
}

const queryIntentSchema = z.object({
  ...provenanceEnvelope,
  intent: z.unknown(),
})

/** NL question → an unvalidated structured-filter intent (validated by the caller). */
export async function queryIntent(
  question: string,
): Promise<{ intent: unknown; provenance: Provenance }> {
  const json = await aiPost<unknown>('/copilot/query-intent', { question })
  const res = queryIntentSchema.parse(json)
  return { intent: res.intent, provenance: res.provenance }
}

export interface RecommendationOut {
  barrier_id: string
  action_type: string
  title: string
  rationale: string
  priority: number
  citations: number[]
  grounded: boolean
}

/** Agent: reason over a patient's barriers + policy → grounded action recommendations. */
export async function recommendActions(
  patientLabel: string,
  barriers: Array<{ id: string; type: string; quote: string }>,
  policy: Array<{ text: string; source: string }>,
): Promise<{ recommendations: RecommendationOut[]; provenance: Provenance }> {
  const res = await aiPost<{
    recommendations: RecommendationOut[]
    provenance: unknown
  }>('/agent/recommend', { patient_label: patientLabel, barriers, policy })
  return {
    recommendations: res.recommendations,
    provenance: z.enum(PROVENANCES).parse(res.provenance),
  }
}

export interface DischargeFeatures {
  id: string
  mffd: boolean
  open_barriers: number
  has_transport: boolean
  has_social_care: boolean
  has_review: boolean
  /**
   * Whole days since admission, derived from `encounters.admittedAt`, or `null`
   * when the encounter carries no admission timestamp. `null` is not a stand-in
   * for zero: the service applies no over-stay penalty for it rather than
   * assuming a length of stay (spec v0.11.0 FR1). Never pass a constant.
   */
  days_admitted: number | null
  edd_set: boolean
}

export async function forecastDischarge(
  patients: DischargeFeatures[],
): Promise<
  Array<{ id: string; p_discharge_24h: number; predicted_days: number }>
> {
  const res = await aiPost<{
    forecasts: Array<{
      id: string
      p_discharge_24h: number
      predicted_days: number
    }>
  }>('/forecast/discharge', { patients })
  return res.forecasts
}

/**
 * Demand projection. Both figures are nullable and callers must handle that:
 * below the service's history threshold there is no honest number to give, and
 * the previous implementation's synthetic `0.5/hr` constant is gone (spec
 * v0.11.0 FR2). Zod-parsed so a service that starts defaulting them to `0`
 * again fails here rather than reaching a bed manager as bold text.
 */
const demandSchema = z
  .object({
    expected_admissions: z.number().nullable(),
    net_beds: z.number().nullable(),
    insufficient_history: z.boolean(),
    reason: z.string().nullable(),
    admissions_last_7d: z.number().int().nullable(),
    window_hours: z.number().int(),
  })
  .refine(
    (d) => d.insufficient_history === (d.expected_admissions === null),
    'demand response contradicts itself: a figure with insufficient history, or no figure without it',
  )

export type DemandResult = z.infer<typeof demandSchema>

export async function forecastDemand(input: {
  free_beds: number
  predicted_discharges: number
  /** Admissions counted over the trailing 7 days; null if unreadable. */
  admissions_last_7d: number | null
  window_hours: number
}): Promise<DemandResult> {
  const json = await aiPost<unknown>('/forecast/demand', input)
  return demandSchema.parse(json)
}

export async function narrateBriefing(payload: {
  /** Only figures that were actually computed. An absent one is omitted, never
   *  passed as 0 — the narrator says so instead of stating a fabricated bed
   *  position (spec v0.11.0 FR3). */
  stats: Record<string, number>
  at_risk: Array<{ label: string; barriers: string[] }>
  predicted_discharges: Array<{
    label: string
    p: number
    predicted_days: number
  }>
  /** Why the demand figures are missing, when they are. */
  demand_unavailable_reason?: string | null
}): Promise<{ briefing: string; provenance: Provenance }> {
  const json = await aiPost<unknown>('/forecast/narrate', payload)
  return z.object({ ...provenanceEnvelope, briefing: z.string() }).parse(json)
}

export type CopilotRoute = 'ward_state' | 'policy' | 'out_of_scope'

/** Classify a question into which answer path should handle it. */
export async function routeQuestion(
  question: string,
): Promise<{ path: CopilotRoute; provenance: Provenance }> {
  const json = await aiPost<unknown>('/copilot/route', { question })
  const res = z.object({ ...provenanceEnvelope, path: z.string() }).parse(json)
  const path =
    res.path === 'ward_state' || res.path === 'policy'
      ? res.path
      : 'out_of_scope'
  return { path, provenance: res.provenance }
}
