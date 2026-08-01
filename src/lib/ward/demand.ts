import 'server-only'

import { and, count, gte, lte } from 'drizzle-orm'

import { db } from '@/db'
import { encounters } from '@/db/schema'
import { logger } from '@/lib/logger'

/**
 * Admission history, the input that replaced the synthetic `0.5/hr` constant
 * the demand forecast used to be built on (spec v0.11.0 FR2).
 *
 * The trailing window is fixed at 7 days to match the AI service's contract
 * (`admissions_last_7d`), so there is one place — `ai/app/forecast.py` — that
 * decides whether the count is enough to project from. This module's only job
 * is to count honestly, including counting zero.
 */

export const HISTORY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Admissions recorded in the trailing 7 days.
 *
 * Returns `null` — not `0` — if the history cannot be read at all, because the
 * service treats the two differently: a genuine `0` is a quiet week, `null` is
 * "we have no idea". Either way no demand figure is produced, but only one of
 * them is a fault worth logging.
 *
 * Counts every encounter admitted in the window, including ones already
 * discharged: an admission that came and went is still an admission, and
 * excluding it would understate demand on a fast-moving ward.
 */
export async function countRecentAdmissions(
  now: Date = new Date(),
): Promise<number | null> {
  const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS)
  try {
    const [row] = await db
      .select({ n: count() })
      .from(encounters)
      .where(
        and(gte(encounters.admittedAt, since), lte(encounters.admittedAt, now)),
      )
    return row?.n ?? 0
  } catch (err) {
    logger.warn('admission history unavailable', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
