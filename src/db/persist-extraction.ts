import { and, eq } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import { reconcileBarriers } from '@/lib/ward/reconcile'

import { maybePurgeRawExtractions } from './purge-raw-extractions'
import {
  aiExtractions,
  barrierEvents,
  barriers,
  barrierSuppressions,
  encounters,
  notes,
} from './schema'

/**
 * Shared persistence for one note's extraction result — used by both the ward
 * board Server Action (`runWardExtractionAction`) and the headless CLI
 * (`run-extraction.ts`) so their write paths can't drift.
 *
 * Since v0.10.0 this **reconciles** rather than delete-and-reinsert. The old
 * path dropped every barrier for the note and re-inserted at `pending`, which
 * meant one person re-running extraction wiped the whole ward's triage — owners,
 * due times, progress notes and approvals all gone. Now AI-derived fields are
 * refreshed in place, human state survives, and a barrier the notes no longer
 * support is flagged rather than removed. The decision rules live in
 * `@/lib/ward/reconcile`; this module only applies them.
 *
 * The whole note is still written in a single transaction, and callers process
 * a given encounter's notes oldest-first so the latest note's MFFD/EDD wins.
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

export interface PersistResult {
  /** Barriers the extraction still supports (inserted + confirmed). */
  barriers: number
  grounded: boolean
  inserted: number
  updated: number
  unconfirmed: number
  /** Incoming barriers dropped because a human had dismissed them. */
  suppressed: number
}

// Loose db type: we only use select/insert/update/transaction, none of which
// depend on the schema generic (drizzle infers columns from the table object,
// not from this parameter), so any postgres-js drizzle instance fits.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = PostgresJsDatabase<any>

export async function persistExtraction(
  db: Db,
  note: NoteRef,
  result: PersistableExtraction,
  now: Date = new Date(),
): Promise<PersistResult> {
  const persisted = await db.transaction(async (tx) => {
    // Prior AI output for this note is superseded; the barriers it produced are
    // reconciled below rather than dropped with it.
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

    const existing = await tx
      .select({
        id: barriers.id,
        type: barriers.type,
        status: barriers.status,
        origin: barriers.origin,
        fingerprint: barriers.fingerprint,
        sourceStart: barriers.sourceStart,
        sourceEnd: barriers.sourceEnd,
        unconfirmedAt: barriers.unconfirmedAt,
      })
      .from(barriers)
      .where(eq(barriers.sourceNoteId, note.id))

    const suppressionRows = await tx
      .select({ fingerprint: barrierSuppressions.fingerprint })
      .from(barrierSuppressions)
      .where(eq(barrierSuppressions.sourceNoteId, note.id))

    const plan = reconcileBarriers({
      incoming: result.barriers,
      existing,
      suppressed: new Set(suppressionRows.map((r) => r.fingerprint)),
      encounterId: note.encounterId,
      sourceNoteId: note.id,
      extractionId: extraction?.id ?? null,
      now,
      newId: () => crypto.randomUUID(),
    })

    if (plan.insert.length > 0) {
      await tx.insert(barriers).values(plan.insert)
    }

    for (const { id, patch } of plan.update) {
      await tx.update(barriers).set(patch).where(eq(barriers.id, id))
    }

    for (const { id, at } of plan.unconfirm) {
      await tx
        .update(barriers)
        .set({ unconfirmedAt: at })
        .where(eq(barriers.id, id))
    }

    if (plan.events.length > 0) {
      await tx.insert(barrierEvents).values(plan.events)
    }

    // Denormalise current discharge status onto the encounter. A clinician-set
    // EDD outranks the model's: extraction may fill an empty date but must
    // never silently overwrite one a person entered (spec v0.10.0 FR9).
    await tx
      .update(encounters)
      .set({
        mffdFlag: result.mffd_flag,
        edd: result.edd ?? null,
        lastExtractedAt: now,
      })
      .where(
        and(
          eq(encounters.id, note.encounterId),
          eq(encounters.eddSource, 'ai'),
        ),
      )

    await tx
      .update(encounters)
      .set({ mffdFlag: result.mffd_flag, lastExtractedAt: now })
      .where(
        and(
          eq(encounters.id, note.encounterId),
          eq(encounters.eddSource, 'human'),
        ),
      )

    await tx
      .update(notes)
      .set({ processedAt: now })
      .where(eq(notes.id, note.id))

    return {
      barriers: plan.insert.length + plan.update.length,
      grounded: result.grounded,
      inserted: plan.insert.length,
      updated: plan.update.length,
      unconfirmed: plan.unconfirm.length,
      suppressed: plan.suppressed.length,
    }
  })

  // Retention (spec v0.12.0 FR8): opportunistically null expired raw_json.
  // Fire-and-forget AFTER the transaction commits — it can neither block nor
  // fail this persist, and it is throttled to one attempt/hour per process.
  maybePurgeRawExtractions(db)

  return persisted
}
