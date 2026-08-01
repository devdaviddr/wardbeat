import { describe, expect, it } from 'vitest'

import type { BarrierType } from '@/db/schema'
import {
  barrierFingerprint,
  type ExistingBarrier,
  type IncomingBarrier,
  normaliseQuote,
  reconcileBarriers,
} from '@/lib/ward/reconcile'

/**
 * The reconcile rules are the load-bearing part of v0.10.0: they are what stops
 * a re-run of extraction from destroying the ward's triage. Every rule gets a
 * case here, plus the failure modes that matter clinically — an approved
 * barrier surviving, a dismissed one staying dismissed, and a cleared one not
 * coming back as pending.
 */

const NOW = new Date('2026-08-01T09:00:00Z')
const EARLIER = new Date('2026-07-30T09:00:00Z')

let idCounter = 0
const newId = () => `new-${++idCounter}`

function incoming(
  type: BarrierType,
  quote: string,
  span?: [number, number],
): IncomingBarrier {
  return {
    type,
    source: { quote, start: span?.[0] ?? null, end: span?.[1] ?? null },
    confidence: 90,
  }
}

function existing(
  over: Partial<ExistingBarrier> & { type: BarrierType; quote?: string },
): ExistingBarrier {
  const { quote, ...rest } = over
  return {
    id: 'b1',
    status: 'pending',
    origin: 'ai',
    fingerprint: barrierFingerprint(over.type, quote ?? 'awaiting tto'),
    sourceStart: null,
    sourceEnd: null,
    unconfirmedAt: null,
    ...rest,
  }
}

function run(
  incomingItems: IncomingBarrier[],
  existingRows: ExistingBarrier[],
  suppressed: string[] = [],
) {
  idCounter = 0
  return reconcileBarriers({
    incoming: incomingItems,
    existing: existingRows,
    suppressed: new Set(suppressed),
    encounterId: 'enc-1',
    sourceNoteId: 'note-1',
    extractionId: 'ext-1',
    now: NOW,
    newId,
  })
}

describe('normaliseQuote', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normaliseQuote('  Awaiting   TTOs, from Pharmacy. ')).toBe(
      'awaiting ttos from pharmacy',
    )
  })

  it('treats punctuation-only differences as identical', () => {
    expect(normaliseQuote('Awaiting TTOs.')).toBe(
      normaliseQuote('awaiting ttos'),
    )
  })
})

describe('barrierFingerprint', () => {
  it('is stable across punctuation and casing changes', () => {
    expect(barrierFingerprint('tto', 'Awaiting TTOs.')).toBe(
      barrierFingerprint('tto', 'awaiting  ttos'),
    )
  })

  it('separates two barriers of the same type on one note', () => {
    expect(barrierFingerprint('review', 'awaiting cardiology review')).not.toBe(
      barrierFingerprint('review', 'awaiting physio review'),
    )
  })

  it('separates the same quote under different types', () => {
    expect(barrierFingerprint('review', 'pending')).not.toBe(
      barrierFingerprint('other', 'pending'),
    )
  })
})

describe('reconcileBarriers — rule 3: new barriers', () => {
  it('inserts an unmatched incoming barrier and logs one created event', () => {
    const result = run([incoming('tto', 'awaiting TTOs')], [])

    expect(result.insert).toHaveLength(1)
    expect(result.insert[0]).toMatchObject({
      type: 'tto',
      status: 'pending',
      origin: 'ai',
      firstSeenAt: NOW,
      lastConfirmedAt: NOW,
    })
    expect(result.update).toHaveLength(0)
    expect(result.events).toEqual([
      expect.objectContaining({ kind: 'created', actorUserId: null }),
    ])
  })
})

describe('reconcileBarriers — rule 2: matching preserves human state', () => {
  it('updates only AI-derived fields, never status or the age anchor', () => {
    const row = existing({
      type: 'tto',
      quote: 'awaiting TTOs',
      status: 'in_progress',
    })
    const result = run([incoming('tto', 'awaiting TTOs')], [row])

    expect(result.update).toHaveLength(1)
    expect(result.update[0]!.id).toBe('b1')
    expect(result.update[0]!.patch).toMatchObject({
      sourceQuote: 'awaiting TTOs',
      confidence: 90,
      lastConfirmedAt: NOW,
      unconfirmedAt: null,
    })
    // The patch must not carry any human-owned field — this is the assertion
    // that stops a future edit from quietly reintroducing the v0.9.x data loss.
    const patched = Object.keys(result.update[0]!.patch)
    for (const humanField of [
      'status',
      'ownerUserId',
      'dueAt',
      'firstSeenAt',
      'clearedAt',
      'clearedReason',
    ]) {
      expect(patched).not.toContain(humanField)
    }
  })

  it('keeps an approved (in_progress) barrier out of insert and unconfirm', () => {
    const row = existing({
      type: 'transport',
      quote: 'transport not booked',
      status: 'in_progress',
    })
    const result = run([incoming('transport', 'transport not booked')], [row])

    expect(result.insert).toHaveLength(0)
    expect(result.unconfirm).toHaveLength(0)
    expect(result.update).toHaveLength(1)
  })

  it('matches on span overlap when the model rephrases the quote', () => {
    const row = existing({
      type: 'review',
      quote: 'awaiting cardiology review',
      sourceStart: 40,
      sourceEnd: 66,
    })
    // Different wording — the fingerprint will not match — but the span does.
    const result = run(
      [incoming('review', 'cardiology review still outstanding', [44, 70])],
      [row],
    )

    expect(result.insert).toHaveLength(0)
    expect(result.update).toHaveLength(1)
    // The fingerprint is refreshed so the next run matches exactly.
    expect(result.update[0]!.patch.fingerprint).toBe(
      barrierFingerprint('review', 'cardiology review still outstanding'),
    )
  })

  it('does not match a different type over an identical span', () => {
    const row = existing({
      type: 'review',
      quote: 'awaiting review',
      sourceStart: 10,
      sourceEnd: 25,
    })
    const result = run([incoming('transport', 'no transport', [10, 25])], [row])

    expect(result.insert).toHaveLength(1)
    expect(result.unconfirm).toHaveLength(1)
  })

  it('never matches two incoming barriers to the same existing row', () => {
    const row = existing({
      type: 'review',
      quote: 'awaiting review',
      sourceStart: 0,
      sourceEnd: 30,
    })
    const result = run(
      [
        incoming('review', 'awaiting cardiology review', [0, 26]),
        incoming('review', 'awaiting physio review', [2, 24]),
      ],
      [row],
    )

    expect(result.update).toHaveLength(1)
    expect(result.insert).toHaveLength(1)
  })

  it('re-confirms a previously unconfirmed barrier and logs it', () => {
    const row = existing({
      type: 'tto',
      quote: 'awaiting TTOs',
      unconfirmedAt: EARLIER,
    })
    const result = run([incoming('tto', 'awaiting TTOs')], [row])

    expect(result.update[0]!.patch.unconfirmedAt).toBeNull()
    expect(result.events).toEqual([
      expect.objectContaining({ kind: 'confirmed', barrierId: 'b1' }),
    ])
  })
})

describe('reconcileBarriers — rule 4: unconfirm, never delete', () => {
  it('flags a barrier the notes no longer support', () => {
    const row = existing({ type: 'tto', quote: 'awaiting TTOs' })
    const result = run([], [row])

    expect(result.unconfirm).toEqual([{ id: 'b1', at: NOW }])
    expect(result.events).toEqual([
      expect.objectContaining({ kind: 'unconfirmed', barrierId: 'b1' }),
    ])
  })

  it('does not re-flag an already-unconfirmed barrier', () => {
    const row = existing({
      type: 'tto',
      quote: 'awaiting TTOs',
      unconfirmedAt: EARLIER,
    })
    const result = run([], [row])

    expect(result.unconfirm).toHaveLength(0)
    expect(result.events).toHaveLength(0)
  })

  it.each(['cleared', 'dismissed'] as const)(
    'leaves a %s barrier alone rather than unconfirming it',
    (status) => {
      const row = existing({ type: 'tto', quote: 'awaiting TTOs', status })
      const result = run([], [row])

      expect(result.unconfirm).toHaveLength(0)
      expect(result.events).toHaveLength(0)
    },
  )
})

describe('reconcileBarriers — rule 5: human authorship is untouchable', () => {
  it('ignores a human-authored barrier entirely', () => {
    const row = existing({
      type: 'social_care',
      quote: 'family meeting needed',
      origin: 'human',
    })
    const result = run([], [row])

    expect(result.unconfirm).toHaveLength(0)
    expect(result.update).toHaveLength(0)
    expect(result.events).toHaveLength(0)
  })

  it('inserts an AI barrier even when a human barrier looks similar', () => {
    const row = existing({
      type: 'tto',
      quote: 'awaiting TTOs',
      origin: 'human',
    })
    const result = run([incoming('tto', 'awaiting TTOs')], [row])

    expect(result.insert).toHaveLength(1)
    expect(result.update).toHaveLength(0)
  })
})

describe('reconcileBarriers — rule 1: dismissal is durable', () => {
  it('drops an incoming barrier whose fingerprint was dismissed', () => {
    const fp = barrierFingerprint('other', 'patient prefers to stay')
    const result = run([incoming('other', 'patient prefers to stay')], [], [fp])

    expect(result.insert).toHaveLength(0)
    expect(result.suppressed).toEqual([fp])
    expect(result.events).toHaveLength(0)
  })

  it('does not resurrect a dismissed barrier across repeated runs', () => {
    const fp = barrierFingerprint('other', 'patient prefers to stay')
    for (let i = 0; i < 3; i++) {
      const result = run(
        [incoming('other', 'patient prefers to stay')],
        [],
        [fp],
      )
      expect(result.insert).toHaveLength(0)
    }
  })

  it('does not resurrect a cleared barrier as pending', () => {
    const row = existing({
      type: 'tto',
      quote: 'awaiting TTOs',
      status: 'cleared',
    })
    const result = run([incoming('tto', 'awaiting TTOs')], [row])

    expect(result.insert).toHaveLength(0)
    expect(result.update).toHaveLength(1)
    expect(Object.keys(result.update[0]!.patch)).not.toContain('status')
  })
})

describe('reconcileBarriers — idempotence (NFR3)', () => {
  it('writes no lifecycle events on an unchanged re-run', () => {
    const rows = [
      existing({ id: 'b1', type: 'tto', quote: 'awaiting TTOs' }),
      existing({
        id: 'b2',
        type: 'transport',
        quote: 'transport not booked',
        status: 'in_progress',
      }),
    ]
    const items = [
      incoming('tto', 'awaiting TTOs'),
      incoming('transport', 'transport not booked'),
    ]

    const first = run(items, rows)
    expect(first.events).toHaveLength(0)
    expect(first.insert).toHaveLength(0)
    expect(first.unconfirm).toHaveLength(0)

    // Running again over the same state stays silent.
    const second = run(items, rows)
    expect(second.events).toHaveLength(0)
    expect(second.update).toHaveLength(2)
  })
})

describe('reconcileBarriers — the regression this release exists to prevent', () => {
  it('preserves every human decision across a full re-extraction', () => {
    const rows: ExistingBarrier[] = [
      existing({
        id: 'approved',
        type: 'tto',
        quote: 'awaiting TTOs',
        status: 'in_progress',
      }),
      existing({
        id: 'done',
        type: 'transport',
        quote: 'transport pending',
        status: 'cleared',
      }),
      existing({
        id: 'mine',
        type: 'social_care',
        quote: 'family meeting needed',
        origin: 'human',
      }),
    ]
    const dismissedFp = barrierFingerprint('other', 'bed rail assessment')

    const result = run(
      [
        incoming('tto', 'awaiting TTOs'),
        incoming('transport', 'transport pending'),
        incoming('other', 'bed rail assessment'),
      ],
      rows,
      [dismissedFp],
    )

    // Nothing is deleted, nothing reverts to pending, the dismissal holds, and
    // the clinician's own barrier is untouched.
    expect(result.insert).toHaveLength(0)
    expect(result.unconfirm).toHaveLength(0)
    expect(result.suppressed).toEqual([dismissedFp])
    expect(result.update.map((u) => u.id).sort()).toEqual(['approved', 'done'])
    expect(result.events).toHaveLength(0)
  })
})
