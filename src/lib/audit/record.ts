import 'server-only'

import { db } from '@/db'
import {
  accessAudit,
  type AccessSubjectType,
  type AccessSurface,
} from '@/db/schema'
import { logger } from '@/lib/logger'

/**
 * The single access-audit writer (spec v0.12.0 M4, FR5/FR7 + NFR3).
 *
 * Every read-audit record in the application is written through
 * `recordAccess`, so auditing lives in one place and a missing call is a
 * visible omission. The `access_audit` table is **append-only**: this module
 * only ever INSERTs, and no application code anywhere may UPDATE or DELETE
 * audit rows (verified by grep at M4 — the only writers to `accessAudit` are
 * in `src/lib/audit/`).
 *
 * NFR3 — auditability never couples to availability:
 * - A failed audit write is logged at `error` and **never propagates** to the
 *   caller. `recordAccess` cannot throw.
 * - Read paths fire it without awaiting (`void recordAccess(...)`) so an
 *   audit write can never block a clinical read.
 */

export type AuditSubjectType = AccessSubjectType
export type AuditSurface = AccessSurface

/**
 * Repeated board reads by the same actor within this window collapse into a
 * single audit row. A board render is ward-granularity telemetry, not a
 * patient access — recording every poll/refresh would drown the records an
 * auditor actually asks about.
 */
export const BOARD_COALESCE_WINDOW_MS = 60_000

/**
 * In-process coalescing state, `actor:subject` → epoch-ms of the last row
 * actually written. Same single-instance caveat as `src/lib/rate-limit.ts`:
 * with multiple app instances each process coalesces independently, so a
 * scaled-out deployment writes up to one board row per instance per window —
 * more rows, never fewer. Swap for a shared store if scaling out.
 */
const recentBoardWrites = new Map<string, number>()

/** Drop expired entries so the map cannot grow without bound. */
function pruneBoardWrites(now: number): void {
  if (recentBoardWrites.size < 1024) return
  for (const [key, at] of recentBoardWrites) {
    if (now - at >= BOARD_COALESCE_WINDOW_MS) recentBoardWrites.delete(key)
  }
}

/**
 * Record that `actorUserId` accessed `subjectId` through `surface`.
 *
 * Never throws and never rejects (NFR3). Callers on read paths should not
 * await it: `void recordAccess({ ... })`.
 */
export async function recordAccess(input: {
  actorUserId: string
  subjectType: AuditSubjectType
  subjectId?: string | null
  surface: AuditSurface
  detail?: unknown
}): Promise<void> {
  try {
    const now = Date.now()

    // Coalesce repeated board reads (board surface only — a bed_drawer or
    // copilot access is always individually recorded).
    if (input.surface === 'board') {
      const key = `${input.actorUserId}:${input.subjectId ?? ''}`
      const lastWrite = recentBoardWrites.get(key)
      if (
        lastWrite !== undefined &&
        now - lastWrite < BOARD_COALESCE_WINDOW_MS
      ) {
        return
      }
      pruneBoardWrites(now)
      // Marked before the INSERT so concurrent renders coalesce too; cleared
      // below if the write fails so a failure never suppresses the next one.
      recentBoardWrites.set(key, now)
      try {
        await insertRow(input)
      } catch (error) {
        recentBoardWrites.delete(key)
        throw error
      }
      return
    }

    await insertRow(input)
  } catch (error) {
    // Never silent, never propagated (NFR3 + spec Observability).
    logger.error('Access audit write failed', {
      actorUserId: input.actorUserId,
      subjectType: input.subjectType,
      subjectId: input.subjectId ?? null,
      surface: input.surface,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function insertRow(input: {
  actorUserId: string
  subjectType: AuditSubjectType
  subjectId?: string | null
  surface: AuditSurface
  detail?: unknown
}): Promise<void> {
  await db.insert(accessAudit).values({
    actorUserId: input.actorUserId,
    subjectType: input.subjectType,
    subjectId: input.subjectId ?? null,
    surface: input.surface,
    detail: input.detail ?? null,
  })
}
