/**
 * Guard for the forecast eval's "omit, don't invent" case (spec v0.11.0 FR3).
 *
 * When the demand projection is absent, the narrator is given no `net_beds`
 * and is asked to say so. The failure to catch is it filling the hole anyway.
 *
 * Extracted from the harness because getting it right took three attempts and
 * each wrong version failed silently in a different direction:
 *
 *  1. Matching only `N beds short|to spare` sailed past a live model writing
 *     "Net bed position is 8" — the same fabrication, different words.
 *  2. Matching any digit near "net" flagged the *correct* refusal ("Net bed
 *     position is not available (only 3 admissions recorded…)") as a failure,
 *     which would have made the honest path the one that breaks the build.
 *
 * Hence: sentence by sentence, and a sentence only counts if it mentions the
 * net position, states a value, and does not disclaim it.
 */

const MENTIONS_POSITION = /\bnet\b|\bbeds? (short|to spare|spare)\b/i

const DISCLAIMED =
  /\b(not available|unavailable|not shown|not stated|cannot|can't|could not|couldn't|no net|not enough|insufficient|not provided|not given|omitted|unknown)\b/i

const ASSERTS_A_VALUE =
  /\b(is|are|of|at|:)\s*-?\d|-?\d+(\.\d+)?\s*beds?\b|\bbeds?\s+(short|to spare|spare|over)\b/i

/** True if the briefing asserts a net bed position it was not given. */
export function statesANetPosition(briefing: string): boolean {
  // Split on sentence ends so a disclaimer in one sentence cannot excuse a
  // fabricated figure in the next.
  return briefing
    .split(/(?<=[.!?])\s+/)
    .some(
      (s) =>
        MENTIONS_POSITION.test(s) &&
        !DISCLAIMED.test(s) &&
        ASSERTS_A_VALUE.test(s),
    )
}
