import { and, isNotNull, lt } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { logger } from '@/lib/logger'

import { aiExtractions } from './schema'

/**
 * Retention purge for `ai_extractions.raw_json` (spec v0.12.0 FR8).
 *
 * Raw model output includes quoted note text, so it must not live forever.
 * Rows older than `AI_RAW_RETENTION_DAYS` (default 30) get `raw_json` nulled;
 * the structured extraction columns (edd, mffd_flag, escalations, grounded,
 * model) are untouched — provenance survives, the raw payload does not.
 *
 * **Opportunistic, not scheduled.** There is no job runner in this stack, so
 * the purge piggybacks on extraction persistence (`persistExtraction`) —
 * matching the v0.10.0 advisory-lock precedent. A ward that never runs
 * extraction again keeps its last raw payloads until the next run; that
 * limitation is documented in CHANGELOG/SECURITY rather than dressed up as a
 * cron.
 */

// Same loose db type as persist-extraction.ts: only `update` is used and
// drizzle infers columns from the table object, not this generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PostgresJsDatabase<any>

const DAY_MS = 24 * 60 * 60_000

/** At most one purge attempt per process per hour — extraction runs persist
 *  one note at a time, and N notes should not mean N table scans. */
const PURGE_MIN_INTERVAL_MS = 60 * 60_000

let lastAttemptAt = 0

/** Test helper — allow the throttle to fire again immediately. */
export function resetPurgeThrottle(): void {
  lastAttemptAt = 0
}

/**
 * Null `raw_json` on rows older than `retentionDays`. Returns the number of
 * rows purged. Throws on DB failure — callers who must not fail go through
 * `maybePurgeRawExtractions`.
 */
export async function purgeExpiredRawExtractions(
  db: Db,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
  const purged = await db
    .update(aiExtractions)
    .set({ rawJson: null })
    .where(
      and(
        isNotNull(aiExtractions.rawJson),
        lt(aiExtractions.createdAt, cutoff),
      ),
    )
    .returning({ id: aiExtractions.id })
  return purged.length
}

/**
 * Fire-and-forget wrapper: reads the retention window from the validated env,
 * throttles to once an hour per process, and **never** throws or rejects — a
 * failed purge must not fail the extraction that triggered it (it logs at
 * `error` instead, since silent retention failure is its own problem).
 */
export function maybePurgeRawExtractions(
  db: Db,
  now: number = Date.now(),
): void {
  if (now - lastAttemptAt < PURGE_MIN_INTERVAL_MS) return
  lastAttemptAt = now

  void (async () => {
    // Dynamic import: the headless CLI (`src/db/run-extraction.ts`) loads
    // dotenv at runtime, after module imports resolve — a static import of
    // '@/lib/env' here would validate an empty process.env at load time and
    // kill the CLI at boot.
    const { env } = await import('@/lib/env')
    const purged = await purgeExpiredRawExtractions(
      db,
      env.AI_RAW_RETENTION_DAYS,
    )
    if (purged > 0) {
      logger.info('raw extraction payloads purged', {
        purged,
        retentionDays: env.AI_RAW_RETENTION_DAYS,
      })
    }
  })().catch((err: unknown) => {
    logger.error('raw extraction purge failed', {
      error: err instanceof Error ? err.message : String(err),
    })
  })
}
