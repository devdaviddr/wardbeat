import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Per-role authorization on EVERY ward-surface server action (spec v0.12.0
 * M3, NFR4). The deliverable here is the negative case: for each action, an
 * under-privileged role is refused AND **no write occurred** — asserting the
 * refusal without asserting the absence of the write is the classic gap.
 *
 * The enforcement checklist (every `'use server'` export on the ward surface):
 *   ward/actions.ts        runWardExtractionAction      → run_extraction
 *   ward/edd.ts            setEncounterEddAction        → override_edd (edd.test.ts)
 *   ward/policy-source.ts  getPolicySource              → view_board
 *   ward/barrier-lifecycle assign/comment               → assign_comment
 *   ward/barrier-lifecycle clear/dismiss/reopen         → clear_dismiss_barrier
 *   ward/barrier-lifecycle createBarrierAction          → create_manual_barrier
 *   actions/decide.ts      approve/dismiss              → approve_recommendation
 *   actions/generate.ts    generateRecommendationsAction→ generate_recommendations
 *   copilot/actions.ts     askCopilotAction             → ask_copilot
 *   briefing/actions.ts    getBriefingSummaryAction     → view_board
 *
 * The database is stubbed following `barrier-lifecycle.test.ts`; the real
 * `requireWardAccess` runs against a mocked session and membership table so
 * these tests exercise the actual matrix, not a mocked gate.
 */

const session = {
  value: null as { user: { id: string; roles?: string[] } } | null,
}
vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: async () => session.value,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const recordAccess = vi.fn(async () => {})
vi.mock('@/lib/audit/record', () => ({
  recordAccess: (...a: unknown[]) =>
    recordAccess(...(a as Parameters<typeof recordAccess>)),
}))

// ---------------------------------------------------------------------------
// Database stub. `authz` is the world `requireWardAccess` resolves against;
// `tx` is the transaction every mutation runs in. Denials must leave BOTH
// untouched.
// ---------------------------------------------------------------------------
const authz = {
  encounter: { id: 'e1', bed: { wardId: 'w1' } } as unknown,
  memberships: [{ wardId: 'w1' }] as Array<{ wardId: string }>,
  barrier: { encounterId: 'e1' } as { encounterId: string } | undefined,
  recommendation: { encounterId: 'e1' } as { encounterId: string } | undefined,
}

const tx = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}
const transaction = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx))
const dbInsert = vi.fn()
const dbUpdate = vi.fn()
const dbDelete = vi.fn()
const policyChunkFindFirst = vi.fn(async () => undefined)

vi.mock('@/db', () => ({
  db: {
    transaction: (fn: (t: typeof tx) => unknown) => transaction(fn),
    insert: (...a: unknown[]) => dbInsert(...a),
    update: (...a: unknown[]) => dbUpdate(...a),
    delete: (...a: unknown[]) => dbDelete(...a),
    query: {
      encounters: { findFirst: async () => authz.encounter },
      userWards: { findMany: async () => authz.memberships },
      wards: { findFirst: async () => ({ id: 'w1' }) },
      barriers: { findFirst: async () => authz.barrier },
      recommendations: {
        findFirst: async () => authz.recommendation,
        findMany: async () => [],
      },
      policyChunks: { findFirst: policyChunkFindFirst },
      policyDocs: { findFirst: async () => undefined },
    },
  },
  sqlClient: {},
}))

// ---------------------------------------------------------------------------
// Everything downstream of the gates is a spy: a denial must never reach it.
// ---------------------------------------------------------------------------
const withExtractionLock = vi.fn(async () => ({
  ok: true,
  processed: 0,
  failed: 0,
  barriers: 0,
  ungrounded: 0,
  inserted: 0,
  updated: 0,
  unconfirmed: 0,
  suppressed: 0,
}))
vi.mock('@/lib/ward/extraction-lock', () => ({
  withExtractionLock: () => withExtractionLock(),
}))
vi.mock('@/db/persist-extraction', () => ({ persistExtraction: vi.fn() }))

const getWardBoard = vi.fn(async () => null as unknown)
vi.mock('@/lib/ward/queries', () => ({ getWardBoard: () => getWardBoard() }))

const routeQuestion = vi.fn(async () => ({
  path: 'out_of_scope' as const,
  provenance: 'mock' as const,
}))
vi.mock('@/lib/ai/client', () => ({
  routeQuestion: () => routeQuestion(),
  extractNote: vi.fn(),
  recommendActions: vi.fn(),
  forecastDischarge: vi.fn(async () => []),
}))
vi.mock('@/lib/copilot/policy', () => ({
  answerPolicyQuestion: vi.fn(),
  retrievePolicy: vi.fn(),
}))
vi.mock('@/lib/copilot/ward', () => ({ answerWardQuestion: vi.fn() }))
vi.mock('@/lib/ai/embedding-model', () => ({
  describeEmbeddingDrift: vi.fn(() => 'drift'),
}))

const getFlowBriefing = vi.fn(async () => null)
vi.mock('@/lib/briefing/briefing', () => ({
  getFlowBriefing: () => getFlowBriefing(),
}))
vi.mock('@/lib/ward/barrier-notify', () => ({
  notifyBarrierAssigned: vi.fn(async () => {}),
  sweepOverdueBarriers: vi.fn(async () => 0),
}))
vi.mock('@/lib/ward/people', () => ({ listAssignees: vi.fn(async () => []) }))

const rateLimit = vi.fn(() => ({ success: true, resetAt: 0 }))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...a: unknown[]) =>
    rateLimit(...(a as Parameters<typeof rateLimit>)),
  AI_LIMITS: {
    copilot: { limit: 5, windowMs: 60_000 },
    briefing: { limit: 5, windowMs: 60_000 },
    generate: { limit: 5, windowMs: 60_000 },
  },
  AI_RATE_LIMIT_MESSAGE: 'Rate limited.',
}))

const {
  assignBarrierAction,
  clearBarrierAction,
  commentOnBarrierAction,
  createBarrierAction,
  dismissBarrierAction,
  reopenBarrierAction,
} = await import('@/lib/ward/barrier-lifecycle')
const { runWardExtractionAction } = await import('@/lib/ward/actions')
const { getPolicySource } = await import('@/lib/ward/policy-source')
const { approveRecommendationAction, dismissRecommendationAction } =
  await import('@/lib/actions/decide')
const { generateRecommendationsAction } = await import('@/lib/actions/generate')
const { askCopilotAction } = await import('@/lib/copilot/actions')
const { getBriefingSummaryAction } = await import('@/lib/briefing/actions')
const { getCockpit } = await import('@/lib/ward/cockpit')

const PERMISSION_DENIED = 'You do not have permission to do this.'
const WARD_DENIED = 'You do not have access to this ward.'

function signIn(roles: string[], memberships = [{ wardId: 'w1' }]) {
  session.value = { user: { id: 'u1', roles } }
  authz.memberships = memberships
}

/** The whole point: a refusal must leave the database untouched. */
function expectNoWrites() {
  expect(transaction).not.toHaveBeenCalled()
  expect(tx.select).not.toHaveBeenCalled()
  expect(tx.update).not.toHaveBeenCalled()
  expect(tx.insert).not.toHaveBeenCalled()
  expect(tx.delete).not.toHaveBeenCalled()
  expect(dbInsert).not.toHaveBeenCalled()
  expect(dbUpdate).not.toHaveBeenCalled()
  expect(dbDelete).not.toHaveBeenCalled()
}

/** Transaction stubs for the positive controls, as in barrier-lifecycle.test.ts. */
function stubTx(rows: unknown[]) {
  tx.select.mockReturnValue({
    from: () => ({
      where: () => ({
        for: () => Promise.resolve(rows),
        orderBy: () => ({ limit: () => Promise.resolve(rows) }),
        limit: () => Promise.resolve(rows),
      }),
    }),
  })
  tx.update.mockReturnValue({ set: () => ({ where: async () => undefined }) })
  tx.insert.mockReturnValue({
    values: () => ({
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      onConflictDoNothing: async () => undefined,
      returning: async () => [{ id: 'new-row' }],
    }),
  })
  tx.delete.mockReturnValue({ where: async () => undefined })
}

beforeEach(() => {
  vi.clearAllMocks()
  authz.encounter = { id: 'e1', bed: { wardId: 'w1' } }
  authz.barrier = { encounterId: 'e1' }
  authz.recommendation = { encounterId: 'e1' }
  signIn(['bed_manager'])
})

// ---------------------------------------------------------------------------
// run_extraction — bed_manager and admin only.
// ---------------------------------------------------------------------------
describe('runWardExtractionAction', () => {
  it.each([['charge_nurse'], ['clinician'], ['allied_health'], ['viewer']])(
    'refuses %s, runs nothing, audits nothing',
    async (role) => {
      signIn([role])

      const res = await runWardExtractionAction()

      expect(res.ok).toBe(false)
      expect(res.error).toBe(PERMISSION_DENIED)
      expect(withExtractionLock).not.toHaveBeenCalled()
      expect(recordAccess).not.toHaveBeenCalled()
      expectNoWrites()
    },
  )

  it('refuses a bed_manager with no ward membership', async () => {
    signIn(['bed_manager'], [])

    const res = await runWardExtractionAction()

    expect(res.ok).toBe(false)
    expect(res.error).toBe(WARD_DENIED)
    expect(withExtractionLock).not.toHaveBeenCalled()
  })

  it('allows a bed_manager and writes the extraction access-audit record', async () => {
    signIn(['bed_manager'])

    const res = await runWardExtractionAction()

    expect(res.ok).toBe(true)
    expect(withExtractionLock).toHaveBeenCalledTimes(1)
    expect(recordAccess).toHaveBeenCalledWith({
      actorUserId: 'u1',
      subjectType: 'ward',
      surface: 'extraction',
    })
  })
})

// ---------------------------------------------------------------------------
// generate_recommendations — bed_manager and admin only. Denials must also
// not consume rate budget (the check runs before the limiter).
// ---------------------------------------------------------------------------
describe('generateRecommendationsAction', () => {
  it.each([['charge_nurse'], ['clinician'], ['allied_health'], ['viewer']])(
    'refuses %s before the board read and the rate limiter',
    async (role) => {
      signIn([role])

      const res = await generateRecommendationsAction()

      expect(res.ok).toBe(false)
      expect(res.error).toBe(PERMISSION_DENIED)
      expect(getWardBoard).not.toHaveBeenCalled()
      expect(rateLimit).not.toHaveBeenCalled()
      expectNoWrites()
    },
  )

  it('allows a bed_manager (empty ward short-circuits cleanly)', async () => {
    signIn(['bed_manager'])

    const res = await generateRecommendationsAction()

    expect(res.ok).toBe(true)
    expect(rateLimit).toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// approve_recommendation — clinician and up. Scoped by the recommendation's
// encounter, resolved before the write transaction opens.
// ---------------------------------------------------------------------------
describe('approve/dismissRecommendationAction', () => {
  it.each([
    ['approve', () => approveRecommendationAction('r1')],
    ['dismiss', () => dismissRecommendationAction('r1')],
  ])('refuses an allied_health %s, and writes nothing', async (_n, call) => {
    signIn(['allied_health'])

    const res = await call()

    expect(res).toEqual({ ok: false, error: PERMISSION_DENIED })
    expectNoWrites()
  })

  it.each([
    ['approve', () => approveRecommendationAction('r1')],
    ['dismiss', () => dismissRecommendationAction('r1')],
  ])('refuses a viewer %s, and writes nothing', async (_n, call) => {
    signIn(['viewer'])

    const res = await call()

    expect(res).toEqual({ ok: false, error: PERMISSION_DENIED })
    expectNoWrites()
  })

  it('refuses a clinician from another ward, and writes nothing', async () => {
    signIn(['clinician'], [{ wardId: 'w2' }])

    const res = await approveRecommendationAction('r1')

    expect(res).toEqual({ ok: false, error: WARD_DENIED })
    expectNoWrites()
  })

  it('allows a clinician in the patient ward (positive control)', async () => {
    signIn(['clinician'])
    stubTx([{ id: 'r1', status: 'proposed', barrierId: null }])

    const res = await approveRecommendationAction('r1')

    expect(res).toEqual({ ok: true })
    expect(transaction).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Barrier lifecycle — assign/comment (assign_comment), clear/dismiss/reopen
// (clear_dismiss_barrier), create (create_manual_barrier). Viewer holds none
// of these; every action must refuse it without a write.
// ---------------------------------------------------------------------------
describe('barrier lifecycle actions', () => {
  it.each([
    ['assign', () => assignBarrierAction('b1', 'user-2')],
    ['comment', () => commentOnBarrierAction('b1', 'chased pharmacy')],
    ['clear', () => clearBarrierAction('b1', 'done')],
    ['dismiss', () => dismissBarrierAction('b1', 'wrong')],
    ['reopen', () => reopenBarrierAction('b1', 'came back')],
    [
      'create',
      () =>
        createBarrierAction({
          encounterId: 'e1',
          type: 'other',
          description: 'family meeting needed',
        }),
    ],
  ])('refuses a viewer %s, and writes nothing', async (_name, call) => {
    signIn(['viewer'])

    const res = await call()

    expect(res).toEqual({ ok: false, error: PERMISSION_DENIED })
    expectNoWrites()
  })

  it('refuses a clinician clearing a barrier in another ward', async () => {
    signIn(['clinician'], [{ wardId: 'w2' }])

    const res = await clearBarrierAction('b1', 'done')

    expect(res).toEqual({ ok: false, error: WARD_DENIED })
    expectNoWrites()
  })

  it('refuses a legacy `member` role (unrecognised ⇒ no capability)', async () => {
    signIn(['member'])

    const res = await clearBarrierAction('b1', 'done')

    expect(res).toEqual({ ok: false, error: PERMISSION_DENIED })
    expectNoWrites()
  })

  it('allows an allied_health clear in their ward (positive control)', async () => {
    signIn(['allied_health'])
    stubTx([
      {
        id: 'b1',
        status: 'pending',
        origin: 'ai',
        type: 'tto',
        sourceQuote: 'awaiting TTOs',
        sourceNoteId: 'n1',
        encounterId: 'e1',
        fingerprint: 'fp1',
        dueAt: null,
        ownerUserId: null,
      },
    ])

    const res = await clearBarrierAction('b1', 'TTOs collected')

    expect(res).toEqual({ ok: true })
  })
})

// ---------------------------------------------------------------------------
// ask_copilot — every ward role, but ward membership is still required, the
// check precedes the rate limiter, and each authorized ask is audited.
// ---------------------------------------------------------------------------
describe('askCopilotAction', () => {
  it('allows a viewer (read-only role can ask)', async () => {
    signIn(['viewer'])

    const res = await askCopilotAction('how many beds are free?')

    expect(res.ok).toBe(true)
    expect(recordAccess).toHaveBeenCalledWith({
      actorUserId: 'u1',
      subjectType: 'copilot_query',
      surface: 'copilot',
      detail: { question: 'how many beds are free?' },
    })
  })

  it('refuses a user with no ward membership before any model call', async () => {
    signIn(['viewer'], [])

    const res = await askCopilotAction('who is in bed 4?')

    expect(res.ok).toBe(false)
    expect(res.error).toBe(WARD_DENIED)
    expect(routeQuestion).not.toHaveBeenCalled()
    expect(rateLimit).not.toHaveBeenCalled()
    expect(recordAccess).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    session.value = null

    const res = await askCopilotAction('anything')

    expect(res.ok).toBe(false)
    expect(res.error).toBe('Not signed in.')
    expect(routeQuestion).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// view_board reads — briefing, policy source, and the cockpit assembly. A
// user with no ward membership sees no patient data on any surface.
// ---------------------------------------------------------------------------
describe('view_board-gated reads', () => {
  it('briefing: viewer can view', async () => {
    signIn(['viewer'])

    const res = await getBriefingSummaryAction()

    expect(res).toEqual({ ok: true, briefing: null })
  })

  it('briefing: no ward membership is refused before the rate limiter', async () => {
    signIn(['clinician'], [])

    const res = await getBriefingSummaryAction()

    expect(res).toEqual({ ok: false, error: WARD_DENIED })
    expect(rateLimit).not.toHaveBeenCalled()
    expect(getFlowBriefing).not.toHaveBeenCalled()
  })

  it('policy source: no ward membership gets null, no lookup', async () => {
    signIn(['clinician'], [])

    const res = await getPolicySource({ chunkId: 'c1' })

    expect(res).toBeNull()
    expect(policyChunkFindFirst).not.toHaveBeenCalled()
  })

  it('policy source: a member may look citations up', async () => {
    signIn(['viewer'])

    await getPolicySource({ chunkId: 'c1' })

    expect(policyChunkFindFirst).toHaveBeenCalled()
  })

  it('cockpit: no ward membership gets null and no board read', async () => {
    signIn(['bed_manager'], [])

    const res = await getCockpit()

    expect(res).toBeNull()
    expect(getWardBoard).not.toHaveBeenCalled()
  })

  it('cockpit: unrecognised legacy role gets null and no board read', async () => {
    signIn(['member'])

    const res = await getCockpit()

    expect(res).toBeNull()
    expect(getWardBoard).not.toHaveBeenCalled()
  })

  it('cockpit: capabilities mirror the matrix for a viewer', async () => {
    signIn(['viewer'])
    getWardBoard.mockResolvedValueOnce({
      wardId: 'w1',
      wardName: 'Ward 1',
      stats: { occupied: 0, free: 0, mffdDelayed: 0, overdue: 0 },
      beds: [],
      lastExtractedAt: null,
    })

    const res = await getCockpit()

    expect(res?.capabilities).toEqual({
      canClear: false,
      canApprove: false,
      canRunExtraction: false,
      canGenerate: false,
      canOverrideEdd: false,
      canCreateBarrier: false,
      canAssignComment: false,
    })
  })

  it('cockpit: capabilities mirror the matrix for a clinician', async () => {
    signIn(['clinician'])
    getWardBoard.mockResolvedValueOnce({
      wardId: 'w1',
      wardName: 'Ward 1',
      stats: { occupied: 0, free: 0, mffdDelayed: 0, overdue: 0 },
      beds: [],
      lastExtractedAt: null,
    })

    const res = await getCockpit()

    expect(res?.capabilities).toEqual({
      canClear: true,
      canApprove: true,
      canRunExtraction: false,
      canGenerate: false,
      canOverrideEdd: true,
      canCreateBarrier: true,
      canAssignComment: true,
    })
  })
})
