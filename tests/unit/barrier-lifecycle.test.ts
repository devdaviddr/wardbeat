import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Validation and authorization behaviour of the barrier lifecycle actions.
 *
 * The database is stubbed: these assert the guards that protect clinical data —
 * that an unauthenticated caller writes nothing, that clearing demands a
 * reason, and crucially that **a rejected action performs no write at all**.
 * Asserting the error message without asserting the absence of the write is the
 * classic gap in tests like these.
 */

const tx = {
  select: vi.fn(),
  update: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
}

const session = { value: null as { user: { id: string } } | null }

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: async () => session.value,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/ward/barrier-notify', () => ({
  notifyBarrierAssigned: vi.fn(async () => {}),
  sweepOverdueBarriers: vi.fn(async () => 0),
}))

vi.mock('@/db', () => ({
  db: {
    transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
  sqlClient: {},
}))

const {
  assignBarrierAction,
  clearBarrierAction,
  commentOnBarrierAction,
  createBarrierAction,
  dismissBarrierAction,
} = await import('@/lib/ward/barrier-lifecycle')

/** Stubs `tx.select()...for('update')` to resolve to `rows`. */
function stubSelect(rows: unknown[]) {
  tx.select.mockReturnValue({
    from: () => ({
      where: () => ({
        for: () => Promise.resolve(rows),
        orderBy: () => ({ limit: () => Promise.resolve(rows) }),
        limit: () => Promise.resolve(rows),
      }),
    }),
  })
}

function stubWrites() {
  tx.update.mockReturnValue({ set: () => ({ where: async () => undefined }) })
  // `values()` is awaited directly in some paths and chained with
  // `.onConflictDoNothing()` / `.returning()` in others, so the stub has to be
  // both thenable and chainable.
  tx.insert.mockReturnValue({
    values: () => ({
      then: (resolve: (v: unknown) => unknown) => resolve(undefined),
      onConflictDoNothing: async () => undefined,
      returning: async () => [{ id: 'new-barrier' }],
    }),
  })
  tx.delete.mockReturnValue({ where: async () => undefined })
}

const OPEN_BARRIER = {
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
}

beforeEach(() => {
  vi.clearAllMocks()
  session.value = { user: { id: 'user-1' } }
  stubWrites()
  stubSelect([OPEN_BARRIER])
})

describe('authorization', () => {
  beforeEach(() => {
    session.value = null
  })

  it.each([
    ['assign', () => assignBarrierAction('b1', 'user-2')],
    ['comment', () => commentOnBarrierAction('b1', 'hello')],
    ['clear', () => clearBarrierAction('b1', 'done')],
    ['dismiss', () => dismissBarrierAction('b1', 'wrong')],
    [
      'create',
      () =>
        createBarrierAction({
          encounterId: 'e1',
          type: 'other',
          description: 'x',
        }),
    ],
  ])('refuses %s when signed out, and writes nothing', async (_name, call) => {
    const res = await call()

    expect(res).toEqual({ ok: false, error: 'Unauthorized' })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.delete).not.toHaveBeenCalled()
  })
})

describe('clearBarrierAction', () => {
  it('requires a reason and writes nothing without one', async () => {
    const res = await clearBarrierAction('b1', '   ')

    expect(res).toEqual({ ok: false, error: 'Say how it was resolved.' })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('clears an open barrier and records the event in the same transaction', async () => {
    const res = await clearBarrierAction('b1', 'TTOs collected')

    expect(res).toEqual({ ok: true })
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.insert).toHaveBeenCalledTimes(1)
  })

  it('refuses to clear an already-cleared barrier', async () => {
    stubSelect([{ ...OPEN_BARRIER, status: 'cleared' }])

    const res = await clearBarrierAction('b1', 'again')

    expect(res).toEqual({ ok: false, error: 'Already cleared.' })
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('directs the user to reopen a dismissed barrier rather than clearing it', async () => {
    stubSelect([{ ...OPEN_BARRIER, status: 'dismissed' }])

    const res = await clearBarrierAction('b1', 'done')

    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/reopen/i)
  })

  it('reports a missing barrier without writing', async () => {
    stubSelect([])

    const res = await clearBarrierAction('missing', 'done')

    expect(res).toEqual({ ok: false, error: 'Barrier not found' })
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('dismissBarrierAction', () => {
  it('suppresses the fingerprint so extraction cannot resurrect it', async () => {
    const res = await dismissBarrierAction('b1', 'not a real barrier')

    expect(res).toEqual({ ok: true })
    // One insert for the suppression, one for the lifecycle event.
    expect(tx.insert).toHaveBeenCalledTimes(2)
  })

  it('does not write a suppression for a clinician-authored barrier', async () => {
    stubSelect([{ ...OPEN_BARRIER, origin: 'human' }])

    const res = await dismissBarrierAction('b1', 'mine, and wrong')

    expect(res).toEqual({ ok: true })
    // Event only — extraction never re-creates a human barrier anyway.
    expect(tx.insert).toHaveBeenCalledTimes(1)
  })

  it('requires a reason', async () => {
    const res = await dismissBarrierAction('b1', '')

    expect(res).toEqual({ ok: false, error: 'Say why this is wrong.' })
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('assignBarrierAction', () => {
  it('rejects an empty owner', async () => {
    const res = await assignBarrierAction('b1', '')

    expect(res.ok).toBe(false)
    expect(tx.update).not.toHaveBeenCalled()
  })

  it('refuses to assign a resolved barrier', async () => {
    stubSelect([{ ...OPEN_BARRIER, status: 'cleared' }])

    const res = await assignBarrierAction('b1', 'user-2')

    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/already cleared/i)
    expect(tx.update).not.toHaveBeenCalled()
  })
})

describe('commentOnBarrierAction', () => {
  it('rejects an empty note', async () => {
    const res = await commentOnBarrierAction('b1', '  ')

    expect(res).toEqual({ ok: false, error: 'Write something first.' })
  })

  it('rejects an oversized note', async () => {
    const res = await commentOnBarrierAction('b1', 'x'.repeat(2001))

    expect(res.ok).toBe(false)
  })
})

describe('createBarrierAction', () => {
  it('requires a description', async () => {
    const res = await createBarrierAction({
      encounterId: 'e1',
      type: 'other',
      description: '   ',
    })

    expect(res).toEqual({ ok: false, error: 'Describe the barrier.' })
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it('refuses when the patient has no note to attribute the barrier to', async () => {
    stubSelect([])

    const res = await createBarrierAction({
      encounterId: 'e1',
      type: 'other',
      description: 'family meeting needed',
    })

    expect(res.ok).toBe(false)
    expect(res.ok === false && res.error).toMatch(/no notes/i)
    expect(tx.insert).not.toHaveBeenCalled()
  })
})
