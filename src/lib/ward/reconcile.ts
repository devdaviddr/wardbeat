import { createHash } from 'node:crypto'

import type {
  BarrierEventKind,
  BarrierOrigin,
  BarrierStatus,
  BarrierType,
} from '@/db/schema'

/**
 * Three-way reconcile between an extraction's output, the barriers already
 * stored for that note, and the fingerprints a human has dismissed.
 *
 * Before v0.10.0 persistence was delete-and-reinsert, which meant a re-run
 * silently destroyed every human decision on the ward — an approved barrier
 * went back to `pending`, its owner and progress log vanished. This module is
 * the replacement: AI-derived fields are refreshed in place, human state is
 * never touched, and a barrier the notes no longer support is marked
 * unconfirmed rather than deleted ("the note stopped saying this" is not the
 * same as "a clinician said it was wrong").
 *
 * Deliberately pure — no database, no clock, no id generation of its own — so
 * every rule below is exhaustively testable. See `tests/unit/reconcile.test.ts`.
 */

/** Barrier as it arrives from the AI plane. */
export interface IncomingBarrier {
  type: BarrierType
  source: { start?: number | null; end?: number | null; quote: string }
  confidence: number
}

/** The subset of a stored barrier row reconcile needs to make its decisions. */
export interface ExistingBarrier {
  id: string
  type: BarrierType
  status: BarrierStatus
  origin: BarrierOrigin
  fingerprint: string
  sourceStart: number | null
  sourceEnd: number | null
  unconfirmedAt: Date | null
}

export interface BarrierPatch {
  sourceQuote: string
  sourceStart: number | null
  sourceEnd: number | null
  confidence: number
  extractionId: string | null
  fingerprint: string
  lastConfirmedAt: Date
  unconfirmedAt: Date | null
}

export interface ReconcileInsert {
  id: string
  encounterId: string
  sourceNoteId: string
  extractionId: string | null
  type: BarrierType
  status: BarrierStatus
  origin: BarrierOrigin
  sourceQuote: string
  sourceStart: number | null
  sourceEnd: number | null
  confidence: number
  fingerprint: string
  firstSeenAt: Date
  lastConfirmedAt: Date
}

export interface ReconcileEvent {
  barrierId: string
  kind: BarrierEventKind
  actorUserId: string | null
  body: string | null
  meta: Record<string, unknown> | null
}

export interface ReconcileResult {
  insert: ReconcileInsert[]
  update: Array<{ id: string; patch: BarrierPatch }>
  unconfirm: Array<{ id: string; at: Date }>
  /** Fingerprints dropped because a human dismissed them. Logged, not stored. */
  suppressed: string[]
  events: ReconcileEvent[]
}

export interface ReconcileInput {
  incoming: IncomingBarrier[]
  existing: ExistingBarrier[]
  /** Fingerprints from `barrier_suppressions` for this note. */
  suppressed: Set<string>
  encounterId: string
  sourceNoteId: string
  extractionId: string | null
  now: Date
  /** Injected so reconcile stays deterministic under test. */
  newId: () => string
}

/**
 * Normalise a quote for fingerprinting: lowercase, drop punctuation, collapse
 * whitespace. The model rephrases spans slightly between runs, so the raw quote
 * is too brittle to match on and the barrier type alone is too coarse (two
 * distinct `review` barriers on one note would collide).
 */
export function normaliseQuote(quote: string): string {
  return quote
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Stable reconcile key for a barrier: its type plus its normalised quote. */
export function barrierFingerprint(type: BarrierType, quote: string): string {
  return createHash('sha256')
    .update(`${type}:${normaliseQuote(quote)}`)
    .digest('hex')
}

/** True when two character spans overlap at all. Null spans never overlap. */
function spansOverlap(
  aStart: number | null | undefined,
  aEnd: number | null | undefined,
  bStart: number | null | undefined,
  bEnd: number | null | undefined,
): boolean {
  if (
    aStart == null ||
    aEnd == null ||
    bStart == null ||
    bEnd == null ||
    aEnd <= aStart ||
    bEnd <= bStart
  ) {
    return false
  }
  return aStart < bEnd && bStart < aEnd
}

/**
 * A barrier whose status a human has resolved. These stay in the matching pool
 * so a re-run recognises them instead of inserting a duplicate — clearing
 * "chase TTOs" must not bring it back as `pending` on the next extraction — but
 * they are never unconfirmed, because their outcome is already recorded.
 */
function isResolved(status: BarrierStatus): boolean {
  return status === 'cleared' || status === 'dismissed'
}

export function reconcileBarriers(input: ReconcileInput): ReconcileResult {
  const {
    incoming,
    existing,
    suppressed,
    encounterId,
    sourceNoteId,
    extractionId,
    now,
    newId,
  } = input

  const result: ReconcileResult = {
    insert: [],
    update: [],
    unconfirm: [],
    suppressed: [],
    events: [],
  }

  // Human-authored barriers are invisible to extraction entirely (FR2).
  const candidates = existing.filter((b) => b.origin === 'ai')
  const matched = new Set<string>()

  for (const item of incoming) {
    const fingerprint = barrierFingerprint(item.type, item.source.quote)

    // Rule 1 — a human dismissed this; do not resurrect it (FR3).
    if (suppressed.has(fingerprint)) {
      result.suppressed.push(fingerprint)
      continue
    }

    // Rule 2 — match an existing row. Exact fingerprint first; failing that,
    // same type with an overlapping span, which survives the model rephrasing
    // the quote between runs.
    const exact = candidates.find(
      (b) => !matched.has(b.id) && b.fingerprint === fingerprint,
    )
    const match =
      exact ??
      candidates.find(
        (b) =>
          !matched.has(b.id) &&
          b.type === item.type &&
          spansOverlap(
            b.sourceStart,
            b.sourceEnd,
            item.source.start,
            item.source.end,
          ),
      )

    if (match) {
      matched.add(match.id)
      // Only AI-derived fields are refreshed. Status, owner, due time, the
      // event log and `firstSeenAt` all belong to the human and are untouched.
      result.update.push({
        id: match.id,
        patch: {
          sourceQuote: item.source.quote,
          sourceStart: item.source.start ?? null,
          sourceEnd: item.source.end ?? null,
          confidence: item.confidence,
          extractionId,
          fingerprint,
          lastConfirmedAt: now,
          unconfirmedAt: null,
        },
      })
      // Only an event when something actually changed for the user, so an
      // unchanged re-run writes no history (NFR3).
      if (match.unconfirmedAt !== null) {
        result.events.push({
          barrierId: match.id,
          kind: 'confirmed',
          actorUserId: null,
          body: null,
          meta: null,
        })
      }
      continue
    }

    // Rule 3 — genuinely new.
    const id = newId()
    result.insert.push({
      id,
      encounterId,
      sourceNoteId,
      extractionId,
      type: item.type,
      status: 'pending',
      origin: 'ai',
      sourceQuote: item.source.quote,
      sourceStart: item.source.start ?? null,
      sourceEnd: item.source.end ?? null,
      confidence: item.confidence,
      fingerprint,
      firstSeenAt: now,
      lastConfirmedAt: now,
    })
    result.events.push({
      barrierId: id,
      kind: 'created',
      actorUserId: null,
      body: null,
      meta: { origin: 'ai' },
    })
  }

  // Rule 4 — the notes no longer support this barrier. Mark it, never delete
  // it: a nurse may still be chasing something the latest note stopped
  // mentioning.
  for (const row of candidates) {
    if (matched.has(row.id)) continue
    if (isResolved(row.status)) continue
    if (row.unconfirmedAt !== null) continue // already flagged; stay idempotent
    result.unconfirm.push({ id: row.id, at: now })
    result.events.push({
      barrierId: row.id,
      kind: 'unconfirmed',
      actorUserId: null,
      body: null,
      meta: null,
    })
  }

  return result
}
