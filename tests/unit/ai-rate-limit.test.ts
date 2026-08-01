import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Per-user rate limiting on the AI-backed server actions (spec v0.12.0 M5).
 *
 * These paths fan out into NIM calls against a shared ~30 RPM budget, so one
 * authenticated user must not be able to drive unbounded model spend. The
 * contract under test: buckets are keyed per user (user A exhausting hers
 * never blocks user B), the refusal is a returned `{ ok: false, error }` with
 * the shared message — never a throw — and the window actually resets.
 */

const session = {
  value: null as { user: { id: string; roles?: string[] } } | null,
}
vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: async () => session.value,
}))

// Access-audit writer is fire-and-forget plumbing here, not under test.
vi.mock('@/lib/audit/record', () => ({ recordAccess: vi.fn(async () => {}) }))

const warn = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() },
}))

// Model plumbing: every model-facing call is a cheap stub — these tests are
// about the gate in front of the calls, not the calls.
const routeQuestion = vi.fn(async () => ({
  path: 'out_of_scope' as const,
  provenance: 'mock' as const,
}))
vi.mock('@/lib/ai/client', () => ({
  routeQuestion: (...a: unknown[]) =>
    routeQuestion(...(a as Parameters<typeof routeQuestion>)),
  recommendActions: vi.fn(),
}))
vi.mock('@/lib/copilot/policy', () => ({
  answerPolicyQuestion: vi.fn(),
  retrievePolicy: vi.fn(),
}))
vi.mock('@/lib/copilot/ward', () => ({ answerWardQuestion: vi.fn() }))

const getFlowBriefing = vi.fn(async () => null)
vi.mock('@/lib/briefing/briefing', () => ({
  getFlowBriefing: () => getFlowBriefing(),
}))

const getWardBoard = vi.fn(async () => null)
vi.mock('@/lib/ward/queries', () => ({ getWardBoard: () => getWardBoard() }))
vi.mock('@/lib/ai/embedding-model', () => ({
  describeEmbeddingDrift: vi.fn(() => 'drift'),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
// Authorization context read by `requireWardAccess` (v0.12.0): every caller
// in this suite is a member of ward w1 — these tests are about the rate
// limit behind the authorization gate, not the gate itself.
vi.mock('@/db', () => ({
  db: {
    query: {
      userWards: { findMany: async () => [{ wardId: 'w1' }] },
      encounters: { findFirst: async () => null },
      wards: { findFirst: async () => ({ id: 'w1' }) },
    },
  },
  sqlClient: {},
}))

const { AI_LIMITS, AI_RATE_LIMIT_MESSAGE, resetRateLimit } =
  await import('@/lib/rate-limit')
const { askCopilotAction } = await import('@/lib/copilot/actions')
const { getBriefingSummaryAction } = await import('@/lib/briefing/actions')
const { generateRecommendationsAction } = await import('@/lib/actions/generate')

function signInAs(id: string) {
  // bed_manager holds every AI-backed capability exercised in this suite.
  session.value = { user: { id, roles: ['bed_manager'] } }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-01T08:00:00Z'))
  resetRateLimit()
  warn.mockClear()
  routeQuestion.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('askCopilotAction rate limit', () => {
  it('refuses with the shared message after the per-user limit', async () => {
    signInAs('user-a')
    for (let i = 0; i < AI_LIMITS.copilot.limit; i++) {
      const res = await askCopilotAction('how many beds are free?')
      expect(res.ok).toBe(true)
    }

    const refused = await askCopilotAction('one more?')
    expect(refused.ok).toBe(false)
    expect(refused.error).toBe(AI_RATE_LIMIT_MESSAGE)
    // No model call happened for the refused question.
    expect(routeQuestion).toHaveBeenCalledTimes(AI_LIMITS.copilot.limit)
    // The rejection is observable in the logs at warn.
    expect(warn).toHaveBeenCalledWith(
      'copilot rate limited',
      expect.objectContaining({ userId: 'user-a' }),
    )
  })

  it('keys per user: user A at the limit does not block user B', async () => {
    signInAs('user-a')
    for (let i = 0; i <= AI_LIMITS.copilot.limit; i++) {
      await askCopilotAction('q')
    }
    signInAs('user-b')
    const res = await askCopilotAction('q')
    expect(res.ok).toBe(true)
    expect(res.error).toBeUndefined()
  })

  it('resets after the window elapses', async () => {
    signInAs('user-a')
    for (let i = 0; i < AI_LIMITS.copilot.limit; i++)
      await askCopilotAction('q')
    expect((await askCopilotAction('q')).ok).toBe(false)

    vi.advanceTimersByTime(AI_LIMITS.copilot.windowMs + 1)
    const res = await askCopilotAction('q')
    expect(res.ok).toBe(true)
  })

  it('does not spend budget on a blank question', async () => {
    signInAs('user-a')
    for (let i = 0; i < AI_LIMITS.copilot.limit * 2; i++) {
      await askCopilotAction('   ')
    }
    const res = await askCopilotAction('real question')
    expect(res.ok).toBe(true)
  })
})

describe('getBriefingSummaryAction rate limit', () => {
  it('returns { ok: false, error } past the limit and isolates users', async () => {
    signInAs('user-a')
    for (let i = 0; i < AI_LIMITS.briefing.limit; i++) {
      expect((await getBriefingSummaryAction()).ok).toBe(true)
    }
    const refused = await getBriefingSummaryAction()
    expect(refused).toEqual({ ok: false, error: AI_RATE_LIMIT_MESSAGE })

    signInAs('user-b')
    expect((await getBriefingSummaryAction()).ok).toBe(true)

    signInAs('user-a')
    vi.advanceTimersByTime(AI_LIMITS.briefing.windowMs + 1)
    expect((await getBriefingSummaryAction()).ok).toBe(true)
  })
})

describe('generateRecommendationsAction rate limit', () => {
  it('returns { ok: false, error } past the limit and isolates users', async () => {
    signInAs('user-a')
    for (let i = 0; i < AI_LIMITS.generate.limit; i++) {
      expect((await generateRecommendationsAction()).ok).toBe(true)
    }
    const refused = await generateRecommendationsAction()
    expect(refused.ok).toBe(false)
    expect(refused.error).toBe(AI_RATE_LIMIT_MESSAGE)
    // The board was never read for the refused run — the gate sits in front
    // of all the expensive work.
    expect(getWardBoard).toHaveBeenCalledTimes(AI_LIMITS.generate.limit)

    signInAs('user-b')
    expect((await generateRecommendationsAction()).ok).toBe(true)

    signInAs('user-a')
    vi.advanceTimersByTime(AI_LIMITS.generate.windowMs + 1)
    expect((await generateRecommendationsAction()).ok).toBe(true)
  })
})
