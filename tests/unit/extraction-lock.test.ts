import 'dotenv/config'

import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Concurrency guard for the ward extraction run (spec v0.10.0 NFR2).
 *
 * This is a **real integration test against Postgres**, deliberately not a mock.
 * The thing under test is a `pg_try_advisory_lock` — a mock would only assert
 * that we call a function we ourselves stubbed, which proves nothing about
 * whether two concurrent runs actually exclude each other. So this talks to the
 * database in `DATABASE_URL` and holds the lock from an genuinely separate
 * connection, exactly as a second app instance would.
 *
 * It skips (loudly) when no database is reachable, so `pnpm test` still passes
 * on a machine with no Postgres — every other suite in this repo is hermetic.
 */

// Must match EXTRACTION_LOCK_KEY in src/lib/ward/extraction-lock.ts. Asserted
// against pg_locks below, so a change to the constant fails this test rather
// than silently drifting.
const EXTRACTION_LOCK_KEY = 574_210_001

const DATABASE_URL = process.env.DATABASE_URL

async function probeDb(): Promise<boolean> {
  if (!DATABASE_URL) return false
  const probe = postgres(DATABASE_URL, {
    max: 1,
    connect_timeout: 3,
    idle_timeout: 1,
    onnotice: () => {},
  })
  try {
    await probe`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await probe.end({ timeout: 2 })
  }
}

const dbReachable = await probeDb()

if (!dbReachable) {
  console.warn(
    '[extraction-lock] SKIPPED — no reachable DATABASE_URL. ' +
      'Run `pnpm docker:db` to exercise the advisory-lock concurrency test.',
  )
}

describe.skipIf(!dbReachable)('extraction advisory lock', () => {
  let withExtractionLock: typeof import('@/lib/ward/extraction-lock').withExtractionLock
  let sqlClient: import('postgres').Sql
  /** An independent connection, standing in for a second app instance. */
  let rival: postgres.Sql

  beforeAll(async () => {
    ;({ withExtractionLock } = await import('@/lib/ward/extraction-lock'))
    ;({ sqlClient } = await import('@/db'))
    rival = postgres(DATABASE_URL!, {
      max: 1,
      connect_timeout: 5,
      onnotice: () => {},
    })
  })

  afterAll(async () => {
    await rival?.end({ timeout: 5 })
    await sqlClient?.end({ timeout: 5 })
  })

  /** How many backends currently hold the extraction advisory lock. */
  async function holdersOfLock(): Promise<number> {
    const rows = await rival<{ n: string }[]>`
      SELECT count(*) AS n FROM pg_locks
      WHERE locktype = 'advisory' AND granted
        AND ((classid::bigint << 32) | objid::bigint) = ${EXTRACTION_LOCK_KEY}
    `
    return Number(rows[0]?.n ?? 0)
  }

  it('starts from a clean slate — nobody holds the lock', async () => {
    expect(await holdersOfLock()).toBe(0)
  })

  it('runs the work and returns its result when the lock is free', async () => {
    const result = await withExtractionLock(async () => 'extracted')

    expect(result).toBe('extracted')
  })

  it('really holds a Postgres advisory lock while the work runs', async () => {
    let seenDuringRun = -1

    await withExtractionLock(async () => {
      // Observed from a different connection, so this is the actual database
      // lock table, not an in-process flag.
      seenDuringRun = await holdersOfLock()
    })

    expect(seenDuringRun).toBe(1)
    expect(await holdersOfLock()).toBe(0)
  })

  it('rejects a run without executing it when another instance holds the lock', async () => {
    const held = await rival<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_lock(${EXTRACTION_LOCK_KEY}) AS locked`
    expect(held[0]?.locked).toBe(true)

    const fn = vi.fn(async () => 'should not run')
    try {
      const result = await withExtractionLock(fn)

      // The point of the whole test: rejected, and the work never started.
      expect(result).toBeNull()
      expect(fn).not.toHaveBeenCalled()
    } finally {
      await rival`SELECT pg_advisory_unlock(${EXTRACTION_LOCK_KEY})`
    }

    // ...and once the rival lets go, a run succeeds again.
    expect(await withExtractionLock(async () => 'ok')).toBe('ok')
  })

  it('lets only one of two genuinely concurrent runs execute', async () => {
    const started: string[] = []
    let releaseFirst!: () => void
    const firstMayFinish = new Promise<void>((r) => {
      releaseFirst = r
    })

    // `a` grabs the lock and parks inside the critical section; `b` arrives
    // while it is held. This is the two-clinicians-click-at-once scenario.
    const a = withExtractionLock(async () => {
      started.push('a')
      await firstMayFinish
      return 'a'
    })

    // Give `a` time to acquire before `b` tries.
    await new Promise((r) => setTimeout(r, 150))
    const b = await withExtractionLock(async () => {
      started.push('b')
      return 'b'
    })

    releaseFirst()
    const aResult = await a

    expect(aResult).toBe('a')
    expect(b).toBeNull()
    expect(started).toEqual(['a'])
    expect(await holdersOfLock()).toBe(0)
  })

  it('releases the lock when the work throws, so the next run is not stuck', async () => {
    await expect(
      withExtractionLock(async () => {
        throw new Error('extraction blew up')
      }),
    ).rejects.toThrow('extraction blew up')

    // A stuck lock here would wedge extraction for the life of the process.
    expect(await holdersOfLock()).toBe(0)
    expect(await withExtractionLock(async () => 'recovered')).toBe('recovered')
  })

  it('does not leak the lock across sequential runs on a pooled connection', async () => {
    // The lock is session-scoped and the connection goes back to the pool, so a
    // missed unlock would survive as a poisoned connection.
    for (let i = 0; i < 5; i++) {
      expect(await withExtractionLock(async () => i)).toBe(i)
    }
    expect(await holdersOfLock()).toBe(0)
  })
})
