import 'server-only'

import { sqlClient } from '@/db'
import { logger } from '@/lib/logger'

/**
 * Mutual exclusion for the ward extraction run.
 *
 * Two clinicians clicking "Run extraction" at once would otherwise both enter
 * the reconcile loop and write overlapping transactions against the same
 * barriers — doubling the model spend and briefly showing a patient with no
 * barriers while one run's writes land on top of the other's.
 *
 * Implemented as a Postgres **session-scoped** advisory lock on a reserved
 * connection rather than an in-process flag, so a crashed or redeployed app
 * cannot leave the lock stuck: Postgres drops it when the connection closes.
 */

// Arbitrary but stable application-wide key. Advisory locks share one keyspace
// across the database, so this must not collide with any other lock we add.
const EXTRACTION_LOCK_KEY = 574_210_001

/**
 * Runs `fn` while holding the extraction lock. Returns `null` without running
 * it when another run already holds the lock — callers surface that to the user
 * rather than queueing, because a second concurrent extraction has no value.
 */
export async function withExtractionLock<T>(
  fn: () => Promise<T>,
): Promise<T | null> {
  const reserved = await sqlClient.reserve()
  try {
    const rows = await reserved<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_lock(${EXTRACTION_LOCK_KEY}) AS locked`

    if (!rows[0]?.locked) {
      logger.warn('extraction lock busy — run rejected')
      return null
    }

    try {
      return await fn()
    } finally {
      await reserved`SELECT pg_advisory_unlock(${EXTRACTION_LOCK_KEY})`
    }
  } finally {
    reserved.release()
  }
}
