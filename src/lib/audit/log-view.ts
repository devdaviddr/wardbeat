'use server'

import { getCurrentSession } from '@/lib/auth/session'
import { recordAccess } from '@/lib/audit/record'

/**
 * Fire-and-forget read-audit action for the bed drawer (spec v0.12.0 FR5).
 *
 * The drawer renders from already-loaded board data — there is no server
 * roundtrip to instrument — so opening a bed with a patient calls this tiny
 * action to record who looked at which patient. That record is what an IG
 * review actually asks for.
 *
 * Always resolves `{ ok: true }`: it is telemetry, and a caller must never
 * branch (or break) on it. Unauthenticated calls write nothing.
 */
export async function logBedViewAction(
  encounterId: string,
): Promise<{ ok: true }> {
  const session = await getCurrentSession()
  const actorUserId = session?.user?.id
  if (!actorUserId || typeof encounterId !== 'string' || !encounterId) {
    return { ok: true }
  }

  // recordAccess never throws (NFR3) — a failed write is logged server-side.
  await recordAccess({
    actorUserId,
    subjectType: 'encounter',
    subjectId: encounterId,
    surface: 'bed_drawer',
  })
  return { ok: true }
}
