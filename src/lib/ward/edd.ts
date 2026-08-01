'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { encounters } from '@/db/schema'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'

/**
 * Clinician override of the estimated discharge date (spec v0.10.0 FR9).
 *
 * The EDD is otherwise whatever the last extraction read out of the notes. A
 * clinician who knows better had no way to say so, and no way to stop the next
 * extraction contradicting them — so the board could keep asserting a date the
 * team had already ruled out. Setting it here marks the encounter's EDD as
 * human-authored, which `persistExtraction` respects: extraction updates MFFD
 * as usual but leaves a human-set date alone.
 */

export type EddResult = { ok: true } | { ok: false; error: string }

/** `YYYY-MM-DD`, the format the rest of the ward domain stores EDD in. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export async function setEncounterEddAction(
  encounterId: string,
  edd: string | null,
): Promise<EddResult> {
  const session = await getCurrentSession()
  const actor = session?.user?.id
  if (!actor) return { ok: false, error: 'Unauthorized' }

  if (edd !== null) {
    if (!ISO_DATE.test(edd)) {
      return { ok: false, error: 'Use a date in YYYY-MM-DD format.' }
    }
    if (Number.isNaN(Date.parse(edd))) {
      return { ok: false, error: 'That is not a real date.' }
    }
  }

  try {
    const updated = await db
      .update(encounters)
      .set({
        edd,
        // Clearing the override hands the field back to extraction rather than
        // freezing it empty.
        eddSource: edd === null ? 'ai' : 'human',
        eddSetByUserId: edd === null ? null : actor,
        eddSetAt: edd === null ? null : new Date(),
      })
      .where(eq(encounters.id, encounterId))
      .returning({ id: encounters.id })

    if (updated.length === 0) {
      return { ok: false, error: 'Patient not found' }
    }

    revalidatePath('/dashboard')
    revalidatePath('/ward')
    logger.info('edd overridden', { encounterId, actor, cleared: edd === null })
    return { ok: true }
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Could not set the date'
    logger.error('edd override failed', { encounterId, error: message })
    return { ok: false, error: message }
  }
}
