import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Access audit (spec v0.12.0 M4 — FR5/FR7 + NFR3).
 *
 * - `recordAccess` writes exactly one row, swallows (and logs) DB failures,
 *   and coalesces repeated board reads per actor within the window.
 * - `logBedViewAction` writes nothing when unauthenticated.
 * - `listAccessAudit` is admin-gated and its filters reach the SQL.
 */

// Hoisted so the vi.mock factories below can safely reference them.
const { dbMock, insertValues, selectChain } = vi.hoisted(() => {
  const insertValues = vi.fn(async () => undefined)
  const selectChain = {
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(async (): Promise<unknown[]> => []),
  }
  selectChain.from.mockReturnValue(selectChain)
  selectChain.leftJoin.mockReturnValue(selectChain)
  selectChain.where.mockReturnValue(selectChain)
  selectChain.orderBy.mockReturnValue(selectChain)
  selectChain.limit.mockReturnValue(selectChain)
  const dbMock = {
    insert: vi.fn(() => ({ values: insertValues })),
    select: vi.fn(() => selectChain),
  }
  return { dbMock, insertValues, selectChain }
})

vi.mock('@/db', () => ({ db: dbMock }))

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))
vi.mock('@/lib/logger', () => ({ logger: mockLogger }))

const mockGetSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: () => mockGetSession(),
}))

const mockRequireWardAccess = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/ward-access', () => ({
  requireWardAccess: mockRequireWardAccess,
}))

import { PgDialect } from 'drizzle-orm/pg-core'

import { BOARD_COALESCE_WINDOW_MS, recordAccess } from '@/lib/audit/record'
import { logBedViewAction } from '@/lib/audit/log-view'
import { AUDIT_PAGE_SIZE, listAccessAudit } from '@/lib/audit/queries'

// The in-process board coalescing map survives across tests (module state),
// so board tests use unique actor ids via this counter.
let actorSeq = 0
const freshActor = () => `actor-${++actorSeq}`

beforeEach(() => {
  dbMock.insert.mockClear()
  dbMock.select.mockClear()
  insertValues.mockClear().mockImplementation(async () => undefined)
  selectChain.from.mockClear()
  selectChain.leftJoin.mockClear()
  selectChain.where.mockClear()
  selectChain.orderBy.mockClear()
  selectChain.limit.mockClear()
  selectChain.offset.mockClear().mockImplementation(async () => [])
  mockLogger.error.mockClear()
  mockGetSession.mockReset()
  mockRequireWardAccess.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

/* -------------------------------------------------------------------------- */
/* recordAccess                                                                */
/* -------------------------------------------------------------------------- */

describe('recordAccess', () => {
  it('writes exactly one row with the given fields', async () => {
    const actor = freshActor()
    await recordAccess({
      actorUserId: actor,
      subjectType: 'encounter',
      subjectId: 'enc-1',
      surface: 'bed_drawer',
      detail: { via: 'test' },
    })

    expect(dbMock.insert).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledWith({
      actorUserId: actor,
      subjectType: 'encounter',
      subjectId: 'enc-1',
      surface: 'bed_drawer',
      detail: { via: 'test' },
    })
  })

  it('defaults subjectId and detail to null', async () => {
    await recordAccess({
      actorUserId: freshActor(),
      subjectType: 'copilot_query',
      surface: 'copilot',
    })
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: null, detail: null }),
    )
  })

  it('swallows and logs a thrown DB error — never propagates (NFR3)', async () => {
    insertValues.mockRejectedValueOnce(new Error('db down'))

    await expect(
      recordAccess({
        actorUserId: freshActor(),
        subjectType: 'encounter',
        subjectId: 'enc-1',
        surface: 'bed_drawer',
      }),
    ).resolves.toBeUndefined()

    expect(mockLogger.error).toHaveBeenCalledTimes(1)
    expect(mockLogger.error.mock.calls[0]?.[0]).toMatch(/audit write failed/i)
  })

  it('coalesces repeated board reads by the same user within the window', async () => {
    const actor = freshActor()
    const input = {
      actorUserId: actor,
      subjectType: 'ward',
      subjectId: 'ward-1',
      surface: 'board',
    } as const

    await recordAccess(input)
    await recordAccess(input)

    expect(insertValues).toHaveBeenCalledTimes(1)
  })

  it('does not coalesce board reads across different users', async () => {
    const base = {
      subjectType: 'ward',
      subjectId: 'ward-1',
      surface: 'board',
    } as const

    await recordAccess({ ...base, actorUserId: freshActor() })
    await recordAccess({ ...base, actorUserId: freshActor() })

    expect(insertValues).toHaveBeenCalledTimes(2)
  })

  it('writes again once the coalescing window has elapsed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T10:00:00Z'))
    const actor = freshActor()
    const input = {
      actorUserId: actor,
      subjectType: 'ward',
      subjectId: 'ward-1',
      surface: 'board',
    } as const

    await recordAccess(input)
    vi.setSystemTime(new Date(Date.now() + BOARD_COALESCE_WINDOW_MS + 1_000))
    await recordAccess(input)

    expect(insertValues).toHaveBeenCalledTimes(2)
  })

  it('a failed board write does not suppress the next attempt', async () => {
    const actor = freshActor()
    const input = {
      actorUserId: actor,
      subjectType: 'ward',
      subjectId: 'ward-1',
      surface: 'board',
    } as const

    insertValues.mockRejectedValueOnce(new Error('db down'))
    await recordAccess(input)
    await recordAccess(input)

    expect(insertValues).toHaveBeenCalledTimes(2)
    expect(mockLogger.error).toHaveBeenCalledTimes(1)
  })

  it('never coalesces non-board surfaces', async () => {
    const actor = freshActor()
    const input = {
      actorUserId: actor,
      subjectType: 'encounter',
      subjectId: 'enc-1',
      surface: 'bed_drawer',
    } as const

    await recordAccess(input)
    await recordAccess(input)

    expect(insertValues).toHaveBeenCalledTimes(2)
  })
})

/* -------------------------------------------------------------------------- */
/* logBedViewAction                                                            */
/* -------------------------------------------------------------------------- */

describe('logBedViewAction', () => {
  it('writes nothing when unauthenticated', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(logBedViewAction('enc-1')).resolves.toEqual({ ok: true })
    expect(dbMock.insert).not.toHaveBeenCalled()
  })

  it('writes nothing for an empty or non-string encounter id', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })

    await logBedViewAction('')
    await logBedViewAction(undefined as unknown as string)

    expect(dbMock.insert).not.toHaveBeenCalled()
  })

  it('records the signed-in user viewing the encounter', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })

    await expect(logBedViewAction('enc-9')).resolves.toEqual({ ok: true })
    expect(insertValues).toHaveBeenCalledTimes(1)
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'u1',
        subjectType: 'encounter',
        subjectId: 'enc-9',
        surface: 'bed_drawer',
      }),
    )
  })
})

/* -------------------------------------------------------------------------- */
/* listAccessAudit                                                             */
/* -------------------------------------------------------------------------- */

const dialect = new PgDialect()

describe('listAccessAudit', () => {
  it('refuses a non-admin and never touches the table', async () => {
    mockRequireWardAccess.mockResolvedValue({ ok: false, error: 'No.' })

    const result = await listAccessAudit({})

    expect(result).toEqual({ ok: false, error: 'No.' })
    expect(mockRequireWardAccess).toHaveBeenCalledWith('view_access_audit', {
      any: true,
    })
    expect(dbMock.select).not.toHaveBeenCalled()
  })

  it('lists newest-first with no filters: no WHERE, limit page+1, offset 0', async () => {
    mockRequireWardAccess.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      wardId: null,
    })
    const row = {
      id: 'a1',
      actorUserId: 'u1',
      actorName: 'Alice',
      actorEmail: 'alice@example.com',
      subjectType: 'encounter',
      subjectId: 'enc-1',
      surface: 'bed_drawer',
      detail: null,
      createdAt: new Date(),
    }
    selectChain.offset.mockResolvedValue([row])

    const result = await listAccessAudit({})

    expect(selectChain.where).toHaveBeenCalledWith(undefined)
    expect(selectChain.limit).toHaveBeenCalledWith(AUDIT_PAGE_SIZE + 1)
    expect(selectChain.offset).toHaveBeenCalledWith(0)
    expect(result).toEqual({ ok: true, rows: [row], page: 0, hasMore: false })
  })

  it('applies actor, subject and date-range filters to the SQL', async () => {
    mockRequireWardAccess.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      wardId: null,
    })
    const from = new Date('2026-07-01T00:00:00Z')
    const to = new Date('2026-07-31T23:59:59Z')

    await listAccessAudit({
      actor: 'alice',
      subjectId: 'enc-1',
      from,
      to,
    })

    const whereArg = selectChain.where.mock.calls[0]?.[0]
    expect(whereArg).toBeDefined()
    const query = dialect.sqlToQuery(whereArg)
    // Actor matches id exactly or name/email case-insensitively.
    expect(query.sql).toMatch(/ilike/i)
    // Dates are bound as ISO strings by the pg driver mapping.
    expect(query.params).toEqual(
      expect.arrayContaining([
        'alice',
        '%alice%',
        'enc-1',
        from.toISOString(),
        to.toISOString(),
      ]),
    )
  })

  it('pages with limit/offset and reports hasMore from the extra row', async () => {
    mockRequireWardAccess.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      wardId: null,
    })
    const rows = Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_, i) => ({
      id: `a${i}`,
      actorUserId: 'u1',
      actorName: null,
      actorEmail: 'a@example.com',
      subjectType: 'ward',
      subjectId: 'ward-1',
      surface: 'board',
      detail: null,
      createdAt: new Date(),
    }))
    selectChain.offset.mockResolvedValue(rows)

    const result = await listAccessAudit({ page: 2 })

    expect(selectChain.offset).toHaveBeenCalledWith(2 * AUDIT_PAGE_SIZE)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.rows).toHaveLength(AUDIT_PAGE_SIZE)
      expect(result.hasMore).toBe(true)
      expect(result.page).toBe(2)
    }
  })

  it('clamps a negative page to 0', async () => {
    mockRequireWardAccess.mockResolvedValue({
      ok: true,
      userId: 'admin-1',
      wardId: null,
    })

    await listAccessAudit({ page: -3 })

    expect(selectChain.offset).toHaveBeenCalledWith(0)
  })
})
