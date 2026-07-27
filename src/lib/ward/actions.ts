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

export interface ExtractionSummary {
  ok: boolean
  processed: number
  failed: number
  barriers: number
  ungrounded: number
  error?: string
}

// Encounters processed at once. The `ai` service enforces the NIM rate limit
// server-side (non-bypassable), so the client no longer needs to serialize to
// stay under the free tier — bounded concurrency cuts wall-time ~Nx. Kept below
// the dev pool (max 5) since each note runs in its own transaction.
const EXTRACTION_CONCURRENCY = 4

/**
 * Ingest → extract → persist for every note on active encounters. Idempotent:
 * each note's prior barriers/extractions are cleared and re-inserted in one
 * transaction (see `persistExtraction`), so it's safe to re-run from the ward
 * board. Encounters run concurrently; a single encounter's notes run
 * oldest-first so its latest note's MFFD/EDD wins. A note that fails (AI error,
 * timeout, bad payload) is isolated and counted — it never aborts the batch.
 */
export async function runWardExtractionAction(): Promise<ExtractionSummary> {
  const session = await getCurrentSession()
  if (!session?.user) {
    return {
      ok: false,
      processed: 0,
      failed: 0,
      barriers: 0,
      ungrounded: 0,
      error: 'Unauthorized',
    }
  }

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
    logger.info('ward extraction complete', {
      processed,
      failed,
      barriers: barrierCount,
      ungrounded,
    })
    return {
      ok: true,
      processed,
      failed,
      barriers: barrierCount,
      ungrounded,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed'
    logger.error('ward extraction failed', { error: message })
    return {
      ok: false,
      processed: 0,
      failed: 0,
      barriers: 0,
      ungrounded: 0,
      error: message,
    }
  }
}
