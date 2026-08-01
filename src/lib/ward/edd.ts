'use server'

import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import { encounters } from '@/db/schema'
import { requireWardAccess } from '@/lib/auth/ward-access'
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

/**
 * True only for a date that actually exists on the calendar.
 *
 * `Date.parse` is not good enough here: when its ISO parser rejects a string,
 * V8 falls back to a lenient parser that **rolls over** rather than failing, so
 * `Date.parse('2026-02-30')` returns 2 March rather than NaN. `edd` is a text
 * column, so Postgres accepts the impossible date verbatim and the board ends
 * up showing "30 Feb" — permanently, because a human-set EDD is never corrected
 * by extraction. Round-tripping the components is the reliable check.
 */
function isRealCalendarDate(iso: string): boolean {
  // Safe to index: the caller has already matched /^\d{4}-\d{2}-\d{2}$/.
  const year = Number(iso.slice(0, 4))
  const month = Number(iso.slice(5, 7))
  const day = Number(iso.slice(8, 10))
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

export async function setEncounterEddAction(
  encounterId: string,
  edd: string | null,
): Promise<EddResult> {
  // Role + ward membership, resolved from the target encounter, checked
  // before validation so a denied caller cannot probe the input rules
  // (spec v0.12.0 M3).
  const access = await requireWardAccess('override_edd', { encounterId })
  if (!access.ok) return access
  const actor = access.userId

  if (edd !== null) {
    if (!ISO_DATE.test(edd)) {
      return { ok: false, error: 'Use a date in YYYY-MM-DD format.' }
    }
    if (!isRealCalendarDate(edd)) {
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
