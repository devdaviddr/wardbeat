import { describe, expect, it } from 'vitest'

import { daysAdmitted } from '@/lib/ward/length-of-stay'

/**
 * Length-of-stay derivation (spec v0.11.0 FR1).
 *
 * `days_admitted` was hardcoded to `3` at every call site that fed the
 * discharge forecast, so the model's length-of-stay term was a constant. These
 * tests pin the two cases that decide whether the replacement is honest: a
 * same-day admission must be 0 rather than 1, and a missing timestamp must be
 * `null` rather than a number, because the forecast treats "unknown" and
 * "admitted today" differently even though they happen to score the same.
 */

const NOW = new Date('2026-08-01T14:00:00Z')
const hoursBefore = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)
const daysBefore = (d: number) => hoursBefore(d * 24)

describe('daysAdmitted', () => {
  it('is 0 for an admission earlier the same day, not 1', () => {
    expect(daysAdmitted(new Date('2026-08-01T02:00:00Z'), NOW)).toBe(0)
  })

  it('is 0 for an admission in the same minute', () => {
    expect(daysAdmitted(NOW, NOW)).toBe(0)
  })

  it('counts elapsed days, so 23h is still 0 and 24h is 1', () => {
    expect(daysAdmitted(hoursBefore(23), NOW)).toBe(0)
    expect(daysAdmitted(hoursBefore(24), NOW)).toBe(1)
    expect(daysAdmitted(hoursBefore(47), NOW)).toBe(1)
    expect(daysAdmitted(hoursBefore(48), NOW)).toBe(2)
  })

  it('does not step up at midnight for a stay under a day', () => {
    // Admitted 23:00 "yesterday", read at 08:00: nine hours in, not a day.
    const admitted = new Date('2026-07-31T23:00:00Z')
    const readAt = new Date('2026-08-01T08:00:00Z')
    expect(daysAdmitted(admitted, readAt)).toBe(0)
  })

  it('derives a long stay', () => {
    expect(daysAdmitted(daysBefore(21), NOW)).toBe(21)
  })

  it('returns null for a missing admission timestamp, never 0', () => {
    expect(daysAdmitted(null, NOW)).toBeNull()
    expect(daysAdmitted(undefined, NOW)).toBeNull()
  })

  it('returns null for an unparseable timestamp rather than NaN', () => {
    expect(daysAdmitted('not a date', NOW)).toBeNull()
    expect(daysAdmitted(new Date('nonsense'), NOW)).toBeNull()
  })

  it('accepts an ISO string as well as a Date', () => {
    expect(daysAdmitted('2026-07-28T14:00:00Z', NOW)).toBe(4)
  })

  it('clamps a future admission to 0 instead of going negative', () => {
    expect(daysAdmitted(new Date('2026-08-05T14:00:00Z'), NOW)).toBe(0)
  })

  it('is monotone in admission time', () => {
    const values = [0, 1, 3, 9, 40].map((d) => daysAdmitted(daysBefore(d), NOW))
    expect(values).toEqual([...values].sort((a, b) => a! - b!))
    expect(values).toEqual([0, 1, 3, 9, 40])
  })

  it('never returns the old hardcoded 3 for an arbitrary stay', () => {
    // Guards the specific regression: a constant would pass every monotonicity
    // check above only if the checks were weak, so assert the values differ.
    const distinct = new Set(
      [0, 1, 2, 4, 5, 8].map((d) => daysAdmitted(daysBefore(d), NOW)),
    )
    expect(distinct.size).toBe(6)
  })
})
