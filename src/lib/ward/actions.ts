'use server'

import { asc } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { persistExtraction } from '@/db/persist-extraction'
import { notes } from '@/db/schema'
import { extractNote } from '@/lib/ai/client'
import { mapPool } from '@/lib/async/pool'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { withExtractionLock } from '@/lib/ward/extraction-lock'

export interface ExtractionSummary {
  ok: boolean
  processed: number
  failed: number
  barriers: number
  ungrounded: number
  /** Barriers first seen by this run. */
  inserted: number
  /** Existing barriers the run re-confirmed, human state untouched. */
  updated: number
  /** Barriers the notes no longer support — flagged, never deleted. */
  unconfirmed: number
  /** Incoming barriers dropped because a clinician had dismissed them. */
  suppressed: number
  error?: string
}

const EMPTY_SUMMARY = {
  processed: 0,
  failed: 0,
  barriers: 0,
  ungrounded: 0,
  inserted: 0,
  updated: 0,
  unconfirmed: 0,
  suppressed: 0,
} as const

// Encounters processed at once. The `ai` service enforces the NIM rate limit
// server-side (non-bypassable), so the client no longer needs to serialize to
// stay under the free tier — bounded concurrency cuts wall-time ~Nx. Kept below
// the dev pool (max 5) since each note runs in its own transaction.
const EXTRACTION_CONCURRENCY = 4

/**
 * Ingest → extract → persist for every note on active encounters.
 *
 * Safe to re-run at any time: each note is **reconciled** rather than rewritten
 * (see `persistExtraction`), so owners, due times, progress notes and approvals
 * survive, and a dismissed barrier is not resurrected. Only one run may be in
 * flight at a time — a concurrent click is rejected rather than queued.
 *
 * Encounters run concurrently; a single encounter's notes run oldest-first so
 * its latest note's MFFD/EDD wins. A note that fails (AI error, timeout, bad
 * payload) is isolated and counted — it never aborts the batch.
 */
export async function runWardExtractionAction(): Promise<ExtractionSummary> {
  const session = await getCurrentSession()
  if (!session?.user) {
    return { ok: false, ...EMPTY_SUMMARY, error: 'Unauthorized' }
  }

  const summary = await withExtractionLock(() => runExtraction())

  if (summary === null) {
    return {
      ok: false,
      ...EMPTY_SUMMARY,
      error: 'An extraction run is already in progress.',
    }
  }

  return summary
}

async function runExtraction(): Promise<ExtractionSummary> {
  try {
    const rows = await db.select().from(notes).orderBy(asc(notes.writtenAt))

    // Group by encounter, preserving oldest-first order within each group, so
    // notes for one patient stay sequential (latest wins) while different
    // patients extract in parallel.
    const byEncounter = new Map<string, typeof rows>()
    for (const note of rows) {
      const group = byEncounter.get(note.encounterId)
      if (group) group.push(note)
      else byEncounter.set(note.encounterId, [note])
    }

    let processed = 0
    let failed = 0
    let barrierCount = 0
    let ungrounded = 0
    let inserted = 0
    let updated = 0
    let unconfirmed = 0
    let suppressed = 0

    const groups = [...byEncounter.values()]
    await mapPool(groups, EXTRACTION_CONCURRENCY, async (group) => {
      for (const note of group) {
        try {
          const result = await extractNote({
            noteId: note.id,
            encounterId: note.encounterId,
            text: note.text,
          })
          const saved = await persistExtraction(db, note, result)
          processed++
          barrierCount += saved.barriers
          inserted += saved.inserted
          updated += saved.updated
          unconfirmed += saved.unconfirmed
          suppressed += saved.suppressed
          if (!saved.grounded) ungrounded++
        } catch (err) {
          failed++
          logger.error('note extraction failed', {
            noteId: note.id,
            error: err instanceof Error ? err.message : String(err),
          })
        }
      }
    })

    revalidatePath('/ward')
    revalidatePath('/dashboard')
    // The reconcile counts are the fastest way to spot a fingerprint
    // regression: a healthy re-run is almost all `updated`, while a spike in
    // `inserted` + `unconfirmed` means matching has stopped working.
    logger.info('ward extraction complete', {
      processed,
      failed,
      barriers: barrierCount,
      ungrounded,
      inserted,
      updated,
      unconfirmed,
      suppressed,
    })
    return {
      ok: true,
      processed,
      failed,
      barriers: barrierCount,
      ungrounded,
      inserted,
      updated,
      unconfirmed,
      suppressed,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed'
    logger.error('ward extraction failed', { error: message })
    return { ok: false, ...EMPTY_SUMMARY, error: message }
  }
}
