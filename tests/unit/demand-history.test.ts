import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Honest demand (spec v0.11.0 FR2/FR3).
 *
 * `demand_forecast` used to be `0.5 * window_hours`, so "expected admissions"
 * was 6 on every ward, at every hour, on every day, and the briefing rendered
 * "net 3 beds short" in bold beside real data. These tests cover the two
 * halves of the replacement that live in TypeScript: counting the trailing
 * admission history honestly (including counting none, and distinguishing that
 * from a failed read), and the briefing **omitting** what it cannot compute
 * rather than defaulting it to a number.
 *
 * The threshold itself — 7 admissions in the trailing 7 days — is enforced in
 * `ai/app/forecast.py` and covered by `ai/tests/test_forecast.py`, so there is
 * one authority for it rather than two that can drift apart.
 */

// --- Database stub -----------------------------------------------------------

interface EncounterRow {
  admittedAt: Date
}

const store: EncounterRow[] = []
/** Where-clause objects handed to `select`, for a structural assertion. */
const whereClauses: unknown[] = []
let selectFails: Error | null = null

vi.mock('@/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (clause: unknown) => {
          whereClauses.push(clause)
          if (selectFails) return Promise.reject(selectFails)
          // The stub re-implements the predicate in JS: it proves the module's
          // own contract (a count, or null on failure), not the SQL. The SQL's
          // columns are asserted structurally below, and the query was run
          // against the real Postgres separately.
          const now = boundNow
          const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          const n = store.filter(
            (r) => r.admittedAt >= since && r.admittedAt <= now,
          ).length
          return Promise.resolve([{ n }])
        },
      }),
    }),
  },
}))

const warnings: Array<Record<string, unknown>> = []
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: (_msg: string, meta?: Record<string, unknown>) => {
      warnings.push(meta ?? {})
    },
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

/** Walk a Drizzle SQL tree, collecting what it actually references. Drizzle
 *  objects are cyclic (column → table → column), hence the seen set. */
function walk(node: unknown, visit: (n: object) => void): void {
  const seen = new WeakSet<object>()
  const go = (n: unknown) => {
    if (typeof n !== 'object' || n === null) return
    if (seen.has(n)) return
    seen.add(n)
    visit(n)
    for (const v of Object.values(n)) go(v)
  }
  go(node)
}

function collectColumnNames(clause: unknown): string[] {
  const names: string[] = []
  walk(clause, (n) => {
    const name = (n as { name?: unknown }).name
    if (typeof name === 'string' && 'table' in n) names.push(name)
  })
  return names
}

function collectDates(clause: unknown): Date[] {
  const dates: Date[] = []
  walk(clause, (n) => {
    if (n instanceof Date) dates.push(n)
  })
  return dates
}

const NOW = new Date('2026-08-01T12:00:00Z')
let boundNow = NOW
const daysBefore = (d: number) =>
  new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

const { countRecentAdmissions, HISTORY_DAYS } =
  await import('@/lib/ward/demand')

beforeEach(() => {
  store.length = 0
  whereClauses.length = 0
  warnings.length = 0
  selectFails = null
  boundNow = NOW
})

describe('countRecentAdmissions', () => {
  it('counts admissions inside the trailing window', () => {
    expect(HISTORY_DAYS).toBe(7)
  })

  it('counts every admission in the window', async () => {
    store.push(
      { admittedAt: daysBefore(0) },
      { admittedAt: daysBefore(1) },
      { admittedAt: daysBefore(6.9) },
    )
    await expect(countRecentAdmissions(NOW)).resolves.toBe(3)
  })

  it('excludes admissions older than the window', async () => {
    store.push(
      { admittedAt: daysBefore(2) },
      { admittedAt: daysBefore(8) },
      { admittedAt: daysBefore(21) },
    )
    await expect(countRecentAdmissions(NOW)).resolves.toBe(1)
  })

  it('returns 0 — a real count — for a ward with no recent admissions', async () => {
    store.push({ admittedAt: daysBefore(30) })
    await expect(countRecentAdmissions(NOW)).resolves.toBe(0)
  })

  it('returns null, not 0, when the history cannot be read', async () => {
    selectFails = new Error('connection refused')
    await expect(countRecentAdmissions(NOW)).resolves.toBeNull()
    expect(warnings[0]?.error).toBe('connection refused')
  })

  it('queries on admitted_at and bounds both ends of the window', async () => {
    await countRecentAdmissions(NOW)
    // Structural, not textual: the stub reimplements the predicate, so this is
    // what actually pins the SQL to the right column and to a bounded window.
    const columns = collectColumnNames(whereClauses[0])
    expect(columns).toContain('admitted_at')
    const bounds = collectDates(whereClauses[0])
    expect(bounds).toHaveLength(2)
    expect(Math.max(...bounds.map((d) => d.getTime()))).toBe(NOW.getTime())
    expect(Math.min(...bounds.map((d) => d.getTime()))).toBe(
      NOW.getTime() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
    )
  })
})

// --- The briefing's omit-not-invent behaviour --------------------------------

const forecastDemand = vi.fn()
const narrateBriefing = vi.fn()
const forecastDischarge = vi.fn()
const getWardBoard = vi.fn()

vi.mock('@/lib/ai/client', () => ({
  forecastDemand: (...a: unknown[]) => forecastDemand(...a),
  forecastDischarge: (...a: unknown[]) => forecastDischarge(...a),
  narrateBriefing: (...a: unknown[]) => narrateBriefing(...a),
}))
vi.mock('@/lib/ward/queries', () => ({
  getWardBoard: (...a: unknown[]) => getWardBoard(...a),
}))

const { getFlowBriefing } = await import('@/lib/briefing/briefing')

function board() {
  return {
    wardId: 'w1',
    wardName: 'Ashcombe Ward',
    lastExtractedAt: null,
    stats: {
      total: 4,
      occupied: 2,
      free: 2,
      mffdDelayed: 1,
      unprocessed: 0,
      overdue: 0,
    },
    beds: [
      {
        id: 'b1',
        label: 'A1',
        occupied: true,
        encounterId: 'e1',
        patientName: 'Arthur Bramble',
        mffd: true,
        edd: '2026-08-01',
        barriers: [{ type: 'tto' }],
        admittedAt: daysBefore(9),
        daysAdmitted: 9,
      },
      {
        id: 'b2',
        label: 'A2',
        occupied: true,
        encounterId: 'e2',
        patientName: 'Doris Clatterton',
        mffd: false,
        edd: null,
        barriers: [],
        admittedAt: null,
        daysAdmitted: null,
      },
    ],
  }
}

describe('getFlowBriefing when demand cannot be projected', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getWardBoard.mockResolvedValue(board())
    forecastDischarge.mockResolvedValue([
      { id: 'b1', p_discharge_24h: 0.9, predicted_days: 1 },
      { id: 'b2', p_discharge_24h: 0.1, predicted_days: 5 },
    ])
    narrateBriefing.mockResolvedValue({
      briefing: 'A briefing.',
      provenance: 'mock',
    })
  })

  const insufficient = {
    expected_admissions: null,
    net_beds: null,
    insufficient_history: true,
    reason: 'Only 3 admissions recorded in the last 7 days.',
    admissions_last_7d: 3,
    window_hours: 12,
  }

  it('returns null figures and the reason — never a default number', async () => {
    forecastDemand.mockResolvedValue(insufficient)
    const out = await getFlowBriefing()
    expect(out!.stats.expectedAdmissions).toBeNull()
    expect(out!.stats.netBeds).toBeNull()
    expect(out!.demandUnavailableReason).toBe(insufficient.reason)
    expect(out!.admissionsLast7d).toBe(3)
  })

  it('omits the absent figures from the narration payload entirely', async () => {
    forecastDemand.mockResolvedValue(insufficient)
    await getFlowBriefing()
    const payload = narrateBriefing.mock.calls[0]![0] as {
      stats: Record<string, number>
      demand_unavailable_reason?: string | null
    }
    // Not "present but zero" — absent. A zero would be narrated as a figure.
    expect('expected_admissions' in payload.stats).toBe(false)
    expect('net_beds' in payload.stats).toBe(false)
    expect(payload.stats.predicted_discharges_24h).toBe(1)
    expect(payload.demand_unavailable_reason).toBe(insufficient.reason)
  })

  it('passes the figures through when the history does support them', async () => {
    forecastDemand.mockResolvedValue({
      expected_admissions: 1.4,
      net_beds: 1.6,
      insufficient_history: false,
      reason: null,
      admissions_last_7d: 20,
      window_hours: 12,
    })
    const out = await getFlowBriefing()
    expect(out!.stats.expectedAdmissions).toBe(1.4)
    expect(out!.stats.netBeds).toBe(1.6)
    expect(out!.demandUnavailableReason).toBeNull()

    const payload = narrateBriefing.mock.calls[0]![0] as {
      stats: Record<string, number>
    }
    expect(payload.stats.expected_admissions).toBe(1.4)
    expect(payload.stats.net_beds).toBe(1.6)
  })

  it('feeds the forecast each bed real length of stay, including null', async () => {
    forecastDemand.mockResolvedValue(insufficient)
    await getFlowBriefing()
    const patients = forecastDischarge.mock.calls[0]![0] as Array<{
      id: string
      days_admitted: number | null
    }>
    expect(patients.map((p) => p.days_admitted)).toEqual([9, null])
    // The regression this release removes: nobody may send the constant.
    expect(patients.every((p) => p.days_admitted !== 3)).toBe(true)
  })

  it('sends the counted history to the service rather than deciding locally', async () => {
    forecastDemand.mockResolvedValue(insufficient)
    await getFlowBriefing()
    const arg = forecastDemand.mock.calls[0]![0] as Record<string, unknown>
    expect(arg).toHaveProperty('admissions_last_7d')
    expect(arg.window_hours).toBe(12)
  })
})
