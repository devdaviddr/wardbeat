/**
 * Length of stay, derived from `encounters.admittedAt` (spec v0.11.0 FR1).
 *
 * Until this release `days_admitted` was hardcoded to `3` at every call site
 * that fed the discharge forecast, which meant the model's length-of-stay term
 * was a constant and the per-bed discharge probability was computed on a
 * fiction. This module is the single derivation; nothing else may invent one.
 *
 * Deliberately free of `server-only` and of any database import so the eval
 * harness and unit tests can use exactly the derivation the product uses.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Whole days elapsed since admission, or `null` when the encounter has no
 * admission timestamp.
 *
 * Counts **elapsed** days rather than calendar days: a patient admitted at
 * 23:00 last night is 0 days in at 08:00, not 1. That is the honest reading
 * for an over-stay penalty, which is what the forecast uses it for, and it
 * avoids the figure stepping up at midnight while nothing about the patient
 * changed.
 *
 * - Same-day admission → `0`, never `1`.
 * - No `admittedAt` → `null`, never `0`. "We don't know" and "arrived today"
 *   are different claims, and the forecast treats them differently.
 * - An admission timestamp in the future (clock skew, a bad import) clamps to
 *   `0` rather than going negative — a negative stay is not a thing, and 0 is
 *   the nearest defensible reading.
 */
export function daysAdmitted(
  admittedAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (admittedAt === null || admittedAt === undefined) return null

  const admitted =
    admittedAt instanceof Date ? admittedAt : new Date(admittedAt)
  const ms = admitted.getTime()
  if (!Number.isFinite(ms)) return null

  const elapsed = now.getTime() - ms
  if (!Number.isFinite(elapsed)) return null

  return Math.max(0, Math.floor(elapsed / DAY_MS))
}
