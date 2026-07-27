import 'server-only'

import { z } from 'zod'

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

/** What the app knows on its own side, independent of reaching the AI plane. */
interface AppSide {
  /** Host of `WARDBEAT_AI_URL` (no scheme/path). */
  aiUrlHost: string
  /** Whether the app is configured to send a service token. */
  serviceTokenConfigured: boolean
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

export async function getAiConfiguration(): Promise<AiConfiguration> {
  const appSide: AppSide = {
    aiUrlHost: hostOf(env.WARDBEAT_AI_URL),
    serviceTokenConfigured: Boolean(env.WARDBEAT_AI_SERVICE_TOKEN),
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
