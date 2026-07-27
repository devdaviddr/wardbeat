import { eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { aiExtractions, barriers, encounters, notes } from './schema'

/**
 * Shared persistence for one note's extraction result — used by both the ward
 * board Server Action (`runWardExtractionAction`) and the headless CLI
 * (`run-extraction.ts`) so their write paths can't drift.
 *
 * The whole note is written in a single transaction: we clear the note's prior
 * barriers/extraction and re-insert atomically, so an idempotent re-run can
 * never leave a note stranded with zero barriers if a later step fails. Callers
 * process a given encounter's notes oldest-first, so the latest note's MFFD/EDD
 * wins on the encounter.
 */

/**
 * The extraction shape both callers hold. Matches the `ai` service `/extract`
 * response (snake_case) — the app validates it via Zod in `@/lib/ai/client`,
 * the CLI reads it straight from `res.json()`; both satisfy this.
 */
export interface PersistableExtraction {
  model: string
  edd?: string | null
  mffd_flag: boolean
  escalations: string[]
  grounded: boolean
  barriers: Array<{
    type: 'tto' | 'transport' | 'social_care' | 'review' | 'other'
    status?: 'pending' | 'in_progress' | 'cleared'
    source: { start?: number | null; end?: number | null; quote: string }
    confidence: number
  }>
}

export interface NoteRef {
  id: string
  encounterId: string
}

// Loose db type: we only use delete/insert/update/transaction, none of which
// depend on the schema generic (drizzle infers columns from the table object,
// not from this parameter), so any postgres-js drizzle instance fits.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PostgresJsDatabase<any>

export async function persistExtraction(
  db: Db,
  note: NoteRef,
  result: PersistableExtraction,
): Promise<{ barriers: number; grounded: boolean }> {
  await db.transaction(async (tx) => {
    // Idempotent re-run: drop this note's prior AI output first.
    await tx.delete(barriers).where(eq(barriers.sourceNoteId, note.id))
    await tx.delete(aiExtractions).where(eq(aiExtractions.noteId, note.id))

    const [extraction] = await tx
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

    if (result.barriers.length > 0) {
      await tx.insert(barriers).values(
        result.barriers.map((b) => ({
          encounterId: note.encounterId,
          sourceNoteId: note.id,
          extractionId: extraction?.id,
          type: b.type,
          status: b.status ?? 'pending',
          sourceQuote: b.source.quote,
          sourceStart: b.source.start ?? null,
          sourceEnd: b.source.end ?? null,
          confidence: b.confidence,
        })),
      )
    }

    // Denormalise current discharge status onto the encounter.
    await tx
      .update(encounters)
      .set({
        mffdFlag: result.mffd_flag,
        edd: result.edd ?? null,
        lastExtractedAt: new Date(),
      })
      .where(eq(encounters.id, note.encounterId))

    await tx
      .update(notes)
      .set({ processedAt: new Date() })
      .where(eq(notes.id, note.id))
  })

  return { barriers: result.barriers.length, grounded: result.grounded }
}
