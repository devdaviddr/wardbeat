import 'server-only'

import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '@/db'
import { policyChunks } from '@/db/schema'
import { env } from '@/lib/env'
import { logger } from '@/lib/logger'

/**
 * Read-only view of the AI plane's live configuration for the Settings page.
 * The AI plane is the single source of truth (its own settings); the app only
 * asks it over the internal service token. Never returns secret values — the AI
 * plane exposes only presence booleans.
 */

const aiPlaneConfigSchema = z.object({
  service_version: z.string(),
  mode: z.enum(['mock', 'live']),
  models: z.object({
    extract: z.string(),
    embed: z.string(),
    rerank: z.string(),
  }),
  endpoint_host: z.string(),
  rate_limit_rpm: z.number(),
  timeout_seconds: z.number(),
  embed_dim: z.number(),
  api_key_configured: z.boolean(),
  service_token_required: z.boolean(),
})

export type AiPlaneConfig = z.infer<typeof aiPlaneConfigSchema>

/**
 * What the stored policy vectors were actually built with, read from the
 * database rather than assumed (spec v0.11.0 FR8). This is the half of the
 * comparison the AI plane cannot answer: `/config` reports what is configured
 * now, and only `policy_chunks.embedding_model` records what embedded the
 * vectors that are already sitting in pgvector.
 */
export interface StoredEmbeddingState {
  /** Distinct model ids across stored chunks. `null` entry = pre-v0.11.0 row. */
  models: Array<string | null>
  /** Total policy chunks in the knowledge base. */
  chunkCount: number
}

/** What the app knows on its own side, independent of reaching the AI plane. */
interface AppSide {
  /** Host of `WARDBEAT_AI_URL` (no scheme/path). */
  aiUrlHost: string
  /** Whether the app is configured to send a service token. */
  serviceTokenConfigured: boolean
  /**
   * The embedding models behind the stored policy KB, or null if the query
   * failed. Shown beside the configured model so a seed/query mismatch is
   * visible before someone trusts an answer built on it.
   */
  storedEmbedding: StoredEmbeddingState | null
}

export type AiConfiguration = AppSide &
  (
    | { reachable: true; plane: AiPlaneConfig }
    | { reachable: false; error: string }
  )

const CONFIG_TIMEOUT_MS = 5_000

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Which models built the policy vectors currently in the database. Never
 * throws: the Settings card degrades to "couldn't read" rather than failing the
 * whole page, but it must not silently report agreement it did not check.
 */
async function readStoredEmbeddingState(): Promise<StoredEmbeddingState | null> {
  try {
    const rows = await db
      .select({
        model: policyChunks.embeddingModel,
        count: sql<number>`count(*)::int`,
      })
      .from(policyChunks)
      .groupBy(policyChunks.embeddingModel)
    return {
      models: rows.map((r) => r.model),
      chunkCount: rows.reduce((sum, r) => sum + Number(r.count), 0),
    }
  } catch (err) {
    logger.warn('stored embedding model read failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

export async function getAiConfiguration(): Promise<AiConfiguration> {
  const appSide: AppSide = {
    aiUrlHost: hostOf(env.WARDBEAT_AI_URL),
    serviceTokenConfigured: Boolean(env.WARDBEAT_AI_SERVICE_TOKEN),
    storedEmbedding: await readStoredEmbeddingState(),
  }

  try {
    const res = await fetch(`${env.WARDBEAT_AI_URL}/config`, {
      headers: env.WARDBEAT_AI_SERVICE_TOKEN
        ? { 'x-service-token': env.WARDBEAT_AI_SERVICE_TOKEN }
        : {},
      cache: 'no-store',
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    })
    if (!res.ok) {
      return {
        ...appSide,
        reachable: false,
        error: `AI service /config returned ${res.status}`,
      }
    }
    const plane = aiPlaneConfigSchema.parse(await res.json())
    return { ...appSide, reachable: true, plane }
  } catch (err) {
    const error =
      err instanceof DOMException && err.name === 'TimeoutError'
        ? 'AI service did not respond in time'
        : err instanceof Error
          ? err.message
          : 'AI service unreachable'
    logger.warn('AI config fetch failed', { error })
    return { ...appSide, reachable: false, error }
  }
}
