import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Clinician override of the estimated discharge date (spec v0.10.0 FR9).
 *
 * The database is stubbed, following `barrier-lifecycle.test.ts`: what matters
 * here is the authorship bookkeeping and the guards. `eddSource` is the field
 * the whole feature turns on — it is what stops the next extraction quietly
 * overwriting a date a clinician set — so every case asserts the exact column
 * payload, not just `{ ok: true }`. Rejected calls must write nothing at all.
 */

const setSpy = vi.fn()
const whereSpy = vi.fn()
const returning = { value: [{ id: 'enc-1' }] as { id: string }[] }
const updateThrows = { value: null as Error | null }

const session = {
  value: null as { user: { id: string; roles?: string[] } } | null,
}

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: async () => session.value,
}))

const revalidatePath = vi.fn()
vi.mock('next/cache', () => ({ revalidatePath }))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/db', () => ({
  db: {
    // Authorization context read by `requireWardAccess` (v0.12.0): the target
    // encounter sits on ward w1 and the caller is a member of w1.
    query: {
      encounters: {
        findFirst: async () => ({ id: 'enc-1', bed: { wardId: 'w1' } }),
      },
      userWards: { findMany: async () => [{ wardId: 'w1' }] },
      wards: { findFirst: async () => ({ id: 'w1' }) },
    },
    update: () => ({
      set: (payload: unknown) => {
        setSpy(payload)
        return {
          where: (clause: unknown) => {
            whereSpy(clause)
            return {
              returning: async () => {
                if (updateThrows.value) throw updateThrows.value
                return returning.value
              },
            }
          },
        }
      },
    }),
  },
  sqlClient: {},
}))

const { setEncounterEddAction } = await import('@/lib/ward/edd')

/** The single `.set({...})` payload sent to the encounters row. */
function writtenPayload(): Record<string, unknown> {
  expect(setSpy).toHaveBeenCalledTimes(1)
  return setSpy.mock.calls[0]?.[0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { id: 'user-1', roles: ['clinician'] } }
  returning.value = [{ id: 'enc-1' }]
  updateThrows.value = null
})

describe('authorization', () => {
  it('refuses a signed-out caller, and writes nothing', async () => {
    session.value = null

    const res = await setEncounterEddAction('enc-1', '2026-08-14')

    expect(res).toEqual({ ok: false, error: 'Not signed in.' })
    expect(setSpy).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller clearing the date too', async () => {
    session.value = null

    const res = await setEncounterEddAction('enc-1', null)

    expect(res).toEqual({ ok: false, error: 'Not signed in.' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('checks the session before validating, so it cannot be probed', async () => {
    session.value = null

    // A malformed date from a signed-out caller must still read as a refusal
    // rather than leaking that the input was the problem.
    const res = await setEncounterEddAction('enc-1', 'nonsense')

    expect(res).toEqual({ ok: false, error: 'Not signed in.' })
  })

  it.each([['allied_health'], ['viewer'], ['member']])(
    'refuses %s (no override_edd capability), and writes nothing',
    async (role) => {
      session.value = { user: { id: 'user-1', roles: [role] } }

      const res = await setEncounterEddAction('enc-1', '2026-08-14')

      expect(res).toEqual({
        ok: false,
        error: 'You do not have permission to do this.',
      })
      expect(setSpy).not.toHaveBeenCalled()
    },
  )
})

describe('date validation', () => {
  it.each([
    ['2026-8-14', 'unpadded month'],
    ['14-08-2026', 'day-first'],
    ['2026/08/14', 'slashes'],
    ['2026-08-14T09:00:00Z', 'a full timestamp'],
    ['', 'an empty string'],
    ['tomorrow', 'free text'],
    [' 2026-08-14', 'leading whitespace'],
    ['2026-08-14 ', 'trailing whitespace'],
  ])('rejects %s (%s) and writes nothing', async (input) => {
    const res = await setEncounterEddAction('enc-1', input)

    expect(res).toEqual({
      ok: false,
      error: 'Use a date in YYYY-MM-DD format.',
    })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['2026-13-01', 'month 13'],
    ['2026-00-10', 'month 00'],
    ['2026-08-32', 'day 32'],
    ['2026-08-00', 'day 00'],
  ])(
    'rejects %s (%s) as not a real date, and writes nothing',
    async (input) => {
      const res = await setEncounterEddAction('enc-1', input)

      expect(res).toEqual({ ok: false, error: 'That is not a real date.' })
      expect(setSpy).not.toHaveBeenCalled()
    },
  )

  /**
   * Regression — these are the dates `Date.parse` silently **rolls over**
   * instead of rejecting (V8 falls back to a lenient parser when its ISO parser
   * fails), so the original guard let every one of them through. `edd` is a
   * `text` column, so Postgres stores the impossible date verbatim; combined
   * with `eddSource: 'human'`, which stops extraction ever correcting it, the
   * board would show "30 Feb 2026" forever while any `new Date(edd)` downstream
   * read it as 2 March.
   */
  it.each([
    ['2026-02-30', '30 February rolls to 2 March'],
    ['2026-04-31', '31 April rolls to 1 May'],
    ['2026-06-31', '31 June rolls to 1 July'],
    ['2026-09-31', '31 September rolls to 1 October'],
    ['2026-11-31', '31 November rolls to 1 December'],
    ['2027-02-29', '29 February in a non-leap year rolls to 1 March'],
  ])('rejects the impossible date %s (%s)', async (input) => {
    const res = await setEncounterEddAction('enc-1', input)

    expect(res).toEqual({ ok: false, error: 'That is not a real date.' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('accepts the last day of every month', async () => {
    const lastDays = [
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
      '2026-10-31',
      '2026-11-30',
      '2026-12-31',
    ]

    for (const day of lastDays) {
      setSpy.mockClear()
      expect(await setEncounterEddAction('enc-1', day)).toEqual({ ok: true })
      expect(writtenPayload().edd).toBe(day)
    }
  })

  it('accepts a real leap day', async () => {
    const res = await setEncounterEddAction('enc-1', '2028-02-29')

    expect(res).toEqual({ ok: true })
    expect(writtenPayload().edd).toBe('2028-02-29')
  })
})

describe('setting a date', () => {
  it('marks the encounter human-authored and records who and when', async () => {
    const before = Date.now()

    const res = await setEncounterEddAction('enc-1', '2026-08-14')

    expect(res).toEqual({ ok: true })
    const payload = writtenPayload()
    expect(payload.edd).toBe('2026-08-14')
    // The field that makes extraction back off.
    expect(payload.eddSource).toBe('human')
    expect(payload.eddSetByUserId).toBe('user-1')
    expect(payload.eddSetAt).toBeInstanceOf(Date)
    expect((payload.eddSetAt as Date).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('attributes the override to the caller, not a client-supplied id', async () => {
    session.value = { user: { id: 'consultant-9', roles: ['clinician'] } }

    await setEncounterEddAction('enc-1', '2026-09-01')

    expect(writtenPayload().eddSetByUserId).toBe('consultant-9')
  })

  it('refreshes the board so the clinician-set date shows immediately', async () => {
    await setEncounterEddAction('enc-1', '2026-08-14')

    expect(revalidatePath).toHaveBeenCalledWith('/dashboard')
    expect(revalidatePath).toHaveBeenCalledWith('/ward')
  })
})

describe('clearing the date', () => {
  it('hands the field back to extraction rather than freezing it empty', async () => {
    const res = await setEncounterEddAction('enc-1', null)

    expect(res).toEqual({ ok: true })
    expect(writtenPayload()).toMatchObject({
      edd: null,
      // Back to 'ai' — the whole point of clearing. Leaving this 'human' would
      // permanently suppress extraction's EDD for this encounter.
      eddSource: 'ai',
      eddSetByUserId: null,
      eddSetAt: null,
    })
  })

  it('drops the previous author, so no stale attribution survives', async () => {
    session.value = { user: { id: 'nurse-2', roles: ['charge_nurse'] } }

    await setEncounterEddAction('enc-1', null)

    const payload = writtenPayload()
    expect(payload.eddSetByUserId).toBeNull()
    expect(payload.eddSetAt).toBeNull()
  })
})

describe('failures', () => {
  it('reports an unknown encounter without throwing', async () => {
    returning.value = []

    const res = await setEncounterEddAction('missing', '2026-08-14')

    expect(res).toEqual({ ok: false, error: 'Patient not found' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('returns a database failure as { ok: false } per the repo convention', async () => {
    updateThrows.value = new Error('connection terminated')

    const res = await setEncounterEddAction('enc-1', '2026-08-14')

    // Never `throw` for a failure the user must see — Next.js redacts thrown
    // messages in a production build (see CLAUDE.md).
    expect(res).toEqual({ ok: false, error: 'connection terminated' })
    expect(revalidatePath).not.toHaveBeenCalled()
  })
})
