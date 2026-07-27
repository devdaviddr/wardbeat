'use server'

import { asc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { aiExtractions, barriers, encounters, notes } from '@/db/schema'
import { extractNote } from '@/lib/ai/client'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'

export interface ExtractionSummary {
  ok: boolean
  processed: number
  barriers: number
  ungrounded: number
  error?: string
}

/**
 * Ingest → extract → persist for every note on active encounters. Idempotent:
 * clears a note's prior barriers/extractions before re-inserting, so it's safe
 * to re-run from the ward board. Notes are processed oldest-first so the latest
 * note's MFFD/EDD wins on the encounter.
 */
export async function runWardExtractionAction(): Promise<ExtractionSummary> {
  const session = await getCurrentSession()
  if (!session?.user) {
    return {
      ok: false,
      processed: 0,
      barriers: 0,
      ungrounded: 0,
      error: 'Unauthorized',
    }
  }

  try {
    const rows = await db.select().from(notes).orderBy(asc(notes.writtenAt))

    let processed = 0
    let barrierCount = 0
    let ungrounded = 0

    // Sequential — the ai service enforces the NIM rate limit; the demo set is
    // small enough that sequential keeps us well under the free tier's 40 RPM.
    for (const note of rows) {
      const result = await extractNote({
        noteId: note.id,
        encounterId: note.encounterId,
        text: note.text,
      })

      // Idempotent re-run: drop this note's prior AI output first.
      await db.delete(barriers).where(eq(barriers.sourceNoteId, note.id))
      await db.delete(aiExtractions).where(eq(aiExtractions.noteId, note.id))

      const [extraction] = await db
        .insert(aiExtractions)
        .values({
          noteId: note.id,
          model: result.model,
          edd: result.edd ?? null,
          mffdFlag: result.mffd_flag,
          escalations: result.escalations,
          grounded: result.grounded,
          rawJson: JSON.stringify(result),
        })
        .returning()

      if (!result.grounded) ungrounded++

      if (result.barriers.length > 0) {
        await db.insert(barriers).values(
          result.barriers.map((b) => ({
            encounterId: note.encounterId,
            sourceNoteId: note.id,
            extractionId: extraction?.id,
            type: b.type,
            status: b.status,
            sourceQuote: b.source.quote,
            sourceStart: b.source.start ?? null,
            sourceEnd: b.source.end ?? null,
            confidence: b.confidence,
          })),
        )
        barrierCount += result.barriers.length
      }

      // Denormalise current discharge status onto the encounter.
      await db
        .update(encounters)
        .set({
          mffdFlag: result.mffd_flag,
          edd: result.edd ?? null,
          lastExtractedAt: new Date(),
        })
        .where(eq(encounters.id, note.encounterId))

      await db
        .update(notes)
        .set({ processedAt: new Date() })
        .where(eq(notes.id, note.id))

      processed++
    }

    revalidatePath('/ward')
    logger.info('ward extraction complete', {
      processed,
      barriers: barrierCount,
      ungrounded,
    })
    return { ok: true, processed, barriers: barrierCount, ungrounded }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Extraction failed'
    logger.error('ward extraction failed', { error: message })
    return {
      ok: false,
      processed: 0,
      barriers: 0,
      ungrounded: 0,
      error: message,
    }
  }
}
