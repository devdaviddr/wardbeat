/**
 * Which embedding model produced a vector — the one fact that makes a pgvector
 * cosine search trustworthy (spec v0.11.0 FR8).
 *
 * Policy chunks are embedded at seed time through the same `/embed` endpoint
 * the copilot uses at query time. Seed in mock mode, switch to live, and the
 * database holds hash-derived vectors while queries use real ones. Both are
 * 1024-d, so pgvector happily returns the "nearest" chunks from an unrelated
 * vector space: no error, no empty result, just confident nonsense with a green
 * grounded badge on top. Comparing model ids is the only cheap way to catch it.
 *
 * Deliberately not `server-only`: the Settings card renders the comparison, and
 * `src/db/migrate.ts` runs outside Next.js entirely.
 */

/**
 * What the AI plane stamps on `/embed` responses when it is running the offline
 * deterministic mock. Mirrors `ai/app/routers/embed.py`, which sends
 * `"mock" if settings.use_mock else settings.nim_embed_model`.
 */
export const MOCK_EMBEDDING_MODEL = 'mock'

/** Placeholder for a stored chunk whose `embedding_model` is null. */
export const UNKNOWN_EMBEDDING_MODEL = 'unknown'

/**
 * The model id the AI plane's `/embed` would stamp right now, derived from what
 * `/config` reports. Kept as one function so the Settings card and the drift
 * check cannot disagree about what "currently configured" means — `/config`
 * reports `models.embed` even in mock mode (it is the model that *would* be
 * used), so the mode has to be folded in.
 */
export function effectiveEmbeddingModel(plane: {
  mode: string
  models: { embed: string }
}): string {
  return plane.mode === 'mock' ? MOCK_EMBEDDING_MODEL : plane.models.embed
}

/**
 * The same rule computed from raw environment variables, for tooling that runs
 * without the AI plane (the migration runner, which must work when only the
 * database is up). Mirrors `Settings.use_mock` in `ai/app/settings.py`: the
 * mock answers whenever `NIM_MOCK` is on OR no API key is present.
 *
 * These variables already exist in `.env.example` and are consumed by the `ai`
 * service; nothing new is introduced here.
 */
export function embeddingModelFromEnv(
  source: Record<string, string | undefined>,
): string {
  const mockFlag = (source.NIM_MOCK ?? 'true').trim().toLowerCase()
  const mock = !['false', '0', 'no', 'off', ''].includes(mockFlag)
  const hasKey = Boolean(source.NVIDIA_API_KEY?.trim())
  if (mock || !hasKey) return MOCK_EMBEDDING_MODEL
  return source.NIM_EMBED_MODEL?.trim() || 'nvidia/nv-embedqa-e5-v5'
}

/**
 * A query embedded with one model, searched against chunks embedded with
 * another. `storedModels` holds every distinct model id seen on the chunks the
 * search actually returned (`unknown` for a pre-v0.11.0 row).
 */
export interface EmbeddingDrift {
  /** The model that embedded the query, per the `/embed` response. */
  queryModel: string
  /** Distinct model ids across the retrieved chunks, sorted. */
  storedModels: string[]
}

/**
 * Compare the query's embedding model against the models that produced the
 * chunks it was matched to. Returns null when they all agree.
 *
 * A null stored model is treated as a mismatch, not as agreement: the backfill
 * in migration 0014 assumed a value it could not verify, so "no record" must
 * never quietly read as "fine".
 */
export function detectEmbeddingDrift(
  queryModel: string,
  storedModels: Array<string | null | undefined>,
): EmbeddingDrift | null {
  if (storedModels.length === 0) return null
  const distinct = [
    ...new Set(storedModels.map((m) => m ?? UNKNOWN_EMBEDDING_MODEL)),
  ].sort()
  const agrees = distinct.length === 1 && distinct[0] === queryModel
  return agrees ? null : { queryModel, storedModels: distinct }
}

/** One sentence a clinician can act on, shared by the UI and the logs. */
export function describeEmbeddingDrift(drift: EmbeddingDrift): string {
  return (
    `Policy search is unreliable: the question was embedded with ` +
    `"${drift.queryModel}" but the stored policy vectors were built with ` +
    `${drift.storedModels.map((m) => `"${m}"`).join(', ')}. ` +
    `Comparing them returns plausible but meaningless matches. ` +
    `Re-seed the policy knowledge base (pnpm db:seed:policy) to fix this.`
  )
}
