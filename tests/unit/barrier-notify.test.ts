import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Web Push for barrier assignment and the overdue sweep (spec v0.10.0 FR11).
 *
 * Both senders are deliberately fire-and-forget: callers invoke them without
 * awaiting, so a push failure must never surface as a failed clinical write.
 * That property is the main thing under test here, alongside the sweep's
 * `overdueNotifiedAt` stamping, which is what stops a board refresh re-alerting.
 *
 * The database is stubbed (following `barrier-lifecycle.test.ts`), with one
 * honest caveat stated where it matters: the stub **reimplements** the sweep's
 * WHERE predicate in JavaScript, so the idempotence tests prove the sweep's own
 * behaviour — that it stamps every row it notifies and sends nothing on a
 * second pass — but they do not prove the SQL. The predicate's columns are
 * asserted structurally instead, and the real send path was separately
 * exercised against Postgres with live VAPID keys.
 */

interface BarrierRow {
  id: string
  type: string
  bedLabel: string | null
  ownerUserId: string | null
  dueAt: Date | null
  status: string
  overdueNotifiedAt: Date | null
}

const store: BarrierRow[] = []
/** Where clauses handed to the sweep's `select`, for structural assertions. */
const sweepWhere: unknown[] = []
const updates: Array<{ id: string; payload: Record<string, unknown> }> = []
const failures = {
  describe: null as Error | null,
  sweepSelect: null as Error | null,
  update: null as Error | null,
}

interface PushPayload {
  title: string
  body: string
  url?: string
}
const sendPushNotification =
  vi.fn<(userId: string, payload: PushPayload) => Promise<void>>()
vi.mock('@/lib/push', () => ({ sendPushNotification }))

/** The `n`th push, failing the test rather than returning undefined. */
function pushAt(n: number): { userId: string; payload: PushPayload } {
  const call = sendPushNotification.mock.calls[n]
  expect(call, `expected a push at index ${n}`).toBeDefined()
  return { userId: call![0], payload: call![1] }
}

const loggedErrors: Array<Record<string, unknown>> = []
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: (msg: string, meta: Record<string, unknown>) => {
      loggedErrors.push({ msg, ...meta })
    },
  },
}))

/** Pulls bound parameter values and column names out of a drizzle SQL node. */
function readSql(node: unknown): { params: unknown[]; columns: string[] } {
  const params: unknown[] = []
  const columns: string[] = []
  const seen = new Set<unknown>()
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object' || seen.has(n)) return
    seen.add(n)
    const node = n as Record<string, unknown> & {
      constructor?: { name: string }
    }
    if (node.constructor?.name === 'Param') {
      params.push(node.value)
      return
    }
    if (typeof node.name === 'string' && node.table) {
      columns.push(node.name)
      return
    }
    const chunks = node.queryChunks
    if (Array.isArray(chunks)) chunks.forEach(walk)
    if (Array.isArray(n)) n.forEach(walk)
  }
  walk(node)
  return { params, columns }
}

vi.mock('@/db', () => ({
  sqlClient: {},
  db: {
    select: () => {
      const ctx: { joined: boolean; where: unknown } = {
        joined: false,
        where: null,
      }
      const chain = {
        from: () => chain,
        // Only describeBarrier joins — that is how the stub tells the two
        // queries apart.
        innerJoin: () => {
          ctx.joined = true
          return chain
        },
        leftJoin: () => chain,
        where: (clause: unknown) => {
          ctx.where = clause
          return chain
        },
        limit: async () => {
          if (ctx.joined) {
            if (failures.describe) throw failures.describe
            const [id] = readSql(ctx.where).params
            const row = store.find((r) => r.id === id)
            return row ? [{ type: row.type, bedLabel: row.bedLabel }] : []
          }
          if (failures.sweepSelect) throw failures.sweepSelect
          sweepWhere.push(ctx.where)
          // NB: this reimplements the SQL predicate — see the file header.
          const now = readSql(ctx.where).params.find(
            (p): p is Date => p instanceof Date,
          )
          return store
            .filter(
              (r) =>
                r.ownerUserId !== null &&
                r.dueAt !== null &&
                now !== undefined &&
                r.dueAt < now &&
                r.overdueNotifiedAt === null &&
                ['pending', 'in_progress'].includes(r.status),
            )
            .map((r) => ({ id: r.id, ownerUserId: r.ownerUserId }))
        },
      }
      return chain
    },
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: async (clause: unknown) => {
          if (failures.update) throw failures.update
          const [id] = readSql(clause).params as [string]
          updates.push({ id, payload })
          const row = store.find((r) => r.id === id)
          if (row) {
            row.overdueNotifiedAt = payload.overdueNotifiedAt as Date
          }
        },
      }),
    }),
  },
}))

const { notifyBarrierAssigned, sweepOverdueBarriers } =
  await import('@/lib/ward/barrier-notify')

function barrier(over: Partial<BarrierRow> = {}): BarrierRow {
  return {
    id: 'b1',
    type: 'tto',
    bedLabel: 'A8',
    ownerUserId: 'user-1',
    dueAt: null,
    status: 'pending',
    overdueNotifiedAt: null,
    ...over,
  }
}

const NOW = new Date('2026-08-01T12:00:00Z')
const PAST = new Date('2026-08-01T09:00:00Z')
const FUTURE = new Date('2026-08-01T18:00:00Z')

beforeEach(() => {
  vi.clearAllMocks()
  sendPushNotification.mockImplementation(async () => {})
  store.length = 0
  sweepWhere.length = 0
  updates.length = 0
  loggedErrors.length = 0
  failures.describe = null
  failures.sweepSelect = null
  failures.update = null
})

describe('notifyBarrierAssigned', () => {
  it('pushes to the new owner when a barrier is assigned', async () => {
    store.push(barrier({ id: 'b1', type: 'tto', bedLabel: 'A8' }))

    await notifyBarrierAssigned('b1', 'user-2')

    expect(sendPushNotification).toHaveBeenCalledTimes(1)
    const { userId, payload } = pushAt(0)
    expect(userId).toBe('user-2')
    expect(payload).toEqual({
      title: 'Assigned: TTOs',
      body: "Bed A8 — you've been asked to chase this.",
      url: '/dashboard',
    })
  })

  it.each([
    ['tto', 'TTOs'],
    ['transport', 'Transport'],
    ['social_care', 'Social care'],
    ['review', 'Review'],
    ['other', 'Barrier'],
  ])('labels a %s barrier as %s', async (type, label) => {
    store.push(barrier({ type }))

    await notifyBarrierAssigned('b1', 'user-2')

    expect(pushAt(0).payload.title).toBe(`Assigned: ${label}`)
  })

  it('falls back to a generic label for an unrecognised type', async () => {
    store.push(barrier({ type: 'newly_added_type' }))

    await notifyBarrierAssigned('b1', 'user-2')

    expect(pushAt(0).payload.title).toBe('Assigned: Barrier')
  })

  it('says "Unbedded" rather than "null" when the encounter has no bed', async () => {
    store.push(barrier({ bedLabel: null }))

    await notifyBarrierAssigned('b1', 'user-2')

    expect(pushAt(0).payload.body).toContain('Bed Unbedded')
  })

  it('never puts patient-identifying detail in a lock-screen payload', async () => {
    // The push body can render on a locked phone, so it carries bed + type only.
    store.push(barrier({ id: 'b1', type: 'transport', bedLabel: 'A8' }))

    await notifyBarrierAssigned('b1', 'user-2')

    const { payload } = pushAt(0)
    const text = `${payload.title} ${payload.body}`
    expect(text).toBe(
      "Assigned: Transport Bed A8 — you've been asked to chase this.",
    )
    // No free-text description, patient name, MRN or encounter id leaks through.
    expect(text).not.toMatch(/\d{6,}/)
  })

  it('sends nothing when the barrier has since vanished', async () => {
    const result = await notifyBarrierAssigned('gone', 'user-2')

    expect(result).toBeUndefined()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('swallows a push failure so the assignment write is never undone', async () => {
    store.push(barrier())
    sendPushNotification.mockRejectedValue(new Error('push service down'))

    // The caller does not await this; a rejection here would be an unhandled
    // rejection in production, not a caught error.
    await expect(notifyBarrierAssigned('b1', 'user-2')).resolves.toBeUndefined()
    expect(loggedErrors[0]).toMatchObject({
      msg: 'barrier assignment notification failed',
      barrierId: 'b1',
      error: 'push service down',
    })
  })

  it('swallows a database failure during the lookup', async () => {
    failures.describe = new Error('connection terminated')

    await expect(notifyBarrierAssigned('b1', 'user-2')).resolves.toBeUndefined()
    expect(sendPushNotification).not.toHaveBeenCalled()
    expect(loggedErrors[0]?.error).toBe('connection terminated')
  })
})

describe('sweepOverdueBarriers', () => {
  it('notifies the owner of each barrier past its due time', async () => {
    store.push(
      barrier({ id: 'b1', ownerUserId: 'u1', dueAt: PAST, bedLabel: 'A1' }),
      barrier({
        id: 'b2',
        ownerUserId: 'u2',
        dueAt: PAST,
        bedLabel: 'A2',
        type: 'transport',
      }),
    )

    const count = await sweepOverdueBarriers(NOW)

    expect(count).toBe(2)
    expect(sendPushNotification).toHaveBeenCalledTimes(2)
    expect(sendPushNotification).toHaveBeenCalledWith('u1', {
      title: 'Overdue: TTOs',
      body: 'Bed A1 — past its due time.',
      url: '/dashboard',
    })
    expect(sendPushNotification).toHaveBeenCalledWith('u2', {
      title: 'Overdue: Transport',
      body: 'Bed A2 — past its due time.',
      url: '/dashboard',
    })
  })

  it('leaves a barrier that is not yet due alone', async () => {
    store.push(barrier({ id: 'b1', ownerUserId: 'u1', dueAt: FUTURE }))

    expect(await sweepOverdueBarriers(NOW)).toBe(0)
    expect(sendPushNotification).not.toHaveBeenCalled()
    expect(updates).toHaveLength(0)
  })

  it('stamps overdueNotifiedAt for every barrier it notifies', async () => {
    store.push(
      barrier({ id: 'b1', ownerUserId: 'u1', dueAt: PAST }),
      barrier({ id: 'b2', ownerUserId: 'u2', dueAt: PAST }),
    )

    await sweepOverdueBarriers(NOW)

    // The stamp is the entire idempotence mechanism — an unstamped row would
    // re-alert on the next board load.
    expect(updates).toEqual([
      { id: 'b1', payload: { overdueNotifiedAt: NOW } },
      { id: 'b2', payload: { overdueNotifiedAt: NOW } },
    ])
  })

  it('is idempotent — a second sweep re-alerts nobody', async () => {
    store.push(
      barrier({ id: 'b1', ownerUserId: 'u1', dueAt: PAST }),
      barrier({ id: 'b2', ownerUserId: 'u2', dueAt: PAST }),
    )

    const first = await sweepOverdueBarriers(NOW)
    expect(first).toBe(2)
    expect(sendPushNotification).toHaveBeenCalledTimes(2)

    // Board refreshed a moment later — the sweep runs on every board read.
    sendPushNotification.mockClear()
    const second = await sweepOverdueBarriers(new Date(NOW.getTime() + 60_000))

    expect(second).toBe(0)
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('stays quiet across many repeat board loads', async () => {
    store.push(barrier({ id: 'b1', ownerUserId: 'u1', dueAt: PAST }))

    await sweepOverdueBarriers(NOW)
    sendPushNotification.mockClear()
    for (let i = 1; i <= 10; i++) {
      expect(
        await sweepOverdueBarriers(new Date(NOW.getTime() + i * 60_000)),
      ).toBe(0)
    }

    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('filters on owner, due time, notified stamp and status in SQL', async () => {
    // The stub reimplements the predicate, so assert the real clause structurally
    // — otherwise these tests would pass even if the WHERE dropped a condition.
    store.push(barrier({ id: 'b1', ownerUserId: 'u1', dueAt: PAST }))

    await sweepOverdueBarriers(NOW)

    expect(sweepWhere).toHaveLength(1)
    const { columns, params } = readSql(sweepWhere[0])
    expect(columns).toEqual(
      expect.arrayContaining([
        'owner_user_id',
        'due_at',
        'overdue_notified_at',
        'status',
      ]),
    )
    expect(params).toContain(NOW)
    expect(params).toEqual(expect.arrayContaining(['pending', 'in_progress']))
  })

  it('never propagates a failure to the board read that triggered it', async () => {
    failures.sweepSelect = new Error('connection terminated')

    // The sweep runs on board render; throwing here would blank the ward board.
    await expect(sweepOverdueBarriers(NOW)).resolves.toBe(0)
    expect(loggedErrors[0]).toMatchObject({
      msg: 'overdue barrier sweep failed',
      error: 'connection terminated',
    })
  })

  it('never propagates a push failure', async () => {
    store.push(barrier({ id: 'b1', ownerUserId: 'u1', dueAt: PAST }))
    sendPushNotification.mockRejectedValue(new Error('push service down'))

    await expect(sweepOverdueBarriers(NOW)).resolves.toBe(0)
    expect(loggedErrors[0]?.error).toBe('push service down')
  })

  it('leaves a row unstamped when its push threw, so it is retried', async () => {
    // Documents current behaviour: the try/catch wraps the whole loop, so a
    // throwing row aborts the batch and is not stamped — it will be picked up
    // by the next sweep rather than being silently dropped.
    store.push(barrier({ id: 'b1', ownerUserId: 'u1', dueAt: PAST }))
    sendPushNotification.mockRejectedValue(new Error('push service down'))

    await sweepOverdueBarriers(NOW)

    expect(updates).toHaveLength(0)
    expect(store[0]?.overdueNotifiedAt).toBeNull()
  })
})
