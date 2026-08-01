import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Retention purge for `ai_extractions.raw_json` (spec v0.12.0 FR8).
 *
 * The database is stubbed (the real cutoff behaviour — old rows nulled, young
 * rows and structured columns untouched — is exercised against local
 * Postgres by `scripts`-style verification; see the release notes). What this
 * file pins down is the contract the app relies on: the purge writes exactly
 * `{ rawJson: null }`, reports how many rows it touched, is throttled, and a
 * purge failure can never propagate to the extraction that triggered it.
 */

const setSpy = vi.fn()
const updateBehaviour = {
  rows: [{ id: 'x1' }, { id: 'x2' }] as { id: string }[],
  throws: null as Error | null,
}

function stubDb() {
  return {
    update: () => {
      if (updateBehaviour.throws) throw updateBehaviour.throws
      return {
        set: (payload: unknown) => {
          setSpy(payload)
          return {
            where: () => ({
              returning: async () => updateBehaviour.rows,
            }),
          }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

const logError = vi.fn()
const logInfo = vi.fn()
vi.mock('@/lib/logger', () => ({
  logger: {
    info: (...a: unknown[]) => logInfo(...a),
    warn: vi.fn(),
    error: (...a: unknown[]) => logError(...a),
    debug: vi.fn(),
  },
}))

// The opportunistic wrapper reads the window from the validated env.
vi.mock('@/lib/env', () => ({ env: { AI_RAW_RETENTION_DAYS: 30 } }))

const {
  maybePurgeRawExtractions,
  purgeExpiredRawExtractions,
  resetPurgeThrottle,
} = await import('@/db/purge-raw-extractions')

async function flushAsync() {
  // The wrapper is fire-and-forget and starts with a dynamic import, which
  // settles on a macrotask — drain a few timer turns, not just microtasks.
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

beforeEach(() => {
  resetPurgeThrottle()
  setSpy.mockClear()
  logError.mockClear()
  logInfo.mockClear()
  updateBehaviour.rows = [{ id: 'x1' }, { id: 'x2' }]
  updateBehaviour.throws = null
})

describe('purgeExpiredRawExtractions', () => {
  it('nulls only rawJson and reports the purged count', async () => {
    const purged = await purgeExpiredRawExtractions(stubDb(), 30)
    expect(purged).toBe(2)
    // Exactly the raw payload — never the structured extraction columns.
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith({ rawJson: null })
  })
})

describe('maybePurgeRawExtractions', () => {
  it('never propagates a purge failure to the caller', async () => {
    updateBehaviour.throws = new Error('db down')
    expect(() => maybePurgeRawExtractions(stubDb())).not.toThrow()
    await flushAsync()
    // ...but the failure is not silent either (NFR: retention failure must
    // be visible in logs).
    expect(logError).toHaveBeenCalledWith(
      'raw extraction purge failed',
      expect.objectContaining({ error: 'db down' }),
    )
  })

  it('throttles to one attempt per interval', async () => {
    const now = Date.now()
    maybePurgeRawExtractions(stubDb(), now)
    maybePurgeRawExtractions(stubDb(), now + 1_000)
    await flushAsync()
    expect(setSpy).toHaveBeenCalledTimes(1)

    // Past the hourly throttle it runs again.
    maybePurgeRawExtractions(stubDb(), now + 61 * 60_000)
    await flushAsync()
    expect(setSpy).toHaveBeenCalledTimes(2)
  })

  it('logs a purge that actually removed rows', async () => {
    maybePurgeRawExtractions(stubDb())
    await flushAsync()
    expect(logInfo).toHaveBeenCalledWith(
      'raw extraction payloads purged',
      expect.objectContaining({ purged: 2, retentionDays: 30 }),
    )
  })
})
