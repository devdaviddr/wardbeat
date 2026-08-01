import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Embedding drift is the release's quietest bug (spec v0.11.0 FR8): seed the
 * policy KB in mock mode, switch to live, and pgvector compares two unrelated
 * 1024-d spaces without raising anything. There is no failing call to observe —
 * only the model ids disagreeing — so these tests pin exactly that.
 */

const { mockEnv, chunkRows } = vi.hoisted(() => ({
  mockEnv: {
    WARDBEAT_AI_URL: 'http://ai.test',
    WARDBEAT_AI_SERVICE_TOKEN: 'token',
  } as Record<string, unknown>,
  chunkRows: {
    value: [] as Array<{
      id: string
      text: string
      docTitle: string
      source: string
      embeddingModel: string | null
    }>,
  },
}))

vi.mock('@/lib/env', () => ({ env: mockEnv }))
vi.mock('@/db', () => ({
  sqlClient: {},
  db: {
    select: () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        orderBy: () => chain,
        limit: async () => chunkRows.value,
      }
      return chain
    },
  },
}))

import { embedText } from '@/lib/ai/client'
import {
  describeEmbeddingDrift,
  detectEmbeddingDrift,
  effectiveEmbeddingModel,
  embeddingModelFromEnv,
  MOCK_EMBEDDING_MODEL,
  UNKNOWN_EMBEDDING_MODEL,
} from '@/lib/ai/embedding-model'
import { answerPolicyQuestion, retrievePolicy } from '@/lib/copilot/policy'

const LIVE_MODEL = 'nvidia/nv-embedqa-e5-v5'

function chunk(embeddingModel: string | null, id = 'c1') {
  return {
    id,
    text: 'TTOs are dispensed within four hours.',
    docTitle: 'TTO Policy',
    source: 'Trust Discharge Policy §4',
    embeddingModel,
  }
}

/** Stub the next AI-service response. */
function respondWith(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
  chunkRows.value = []
})

describe('detectEmbeddingDrift', () => {
  it('reports no drift when every chunk came from the query model', () => {
    expect(
      detectEmbeddingDrift(LIVE_MODEL, [LIVE_MODEL, LIVE_MODEL]),
    ).toBeNull()
  })

  it('detects the mock-seeded / live-queried case', () => {
    const drift = detectEmbeddingDrift(LIVE_MODEL, [MOCK_EMBEDDING_MODEL])
    expect(drift).toEqual({
      queryModel: LIVE_MODEL,
      storedModels: [MOCK_EMBEDDING_MODEL],
    })
  })

  it('detects the reverse — live-seeded, then queried under NIM_MOCK', () => {
    const drift = detectEmbeddingDrift(MOCK_EMBEDDING_MODEL, [LIVE_MODEL])
    expect(drift?.storedModels).toEqual([LIVE_MODEL])
  })

  it('treats an unrecorded model as drift, not as agreement', () => {
    // Migration 0014 backfills an assumption. "No record" must never quietly
    // read as "matches".
    const drift = detectEmbeddingDrift(LIVE_MODEL, [null])
    expect(drift?.storedModels).toEqual([UNKNOWN_EMBEDDING_MODEL])
  })

  it('flags a KB that is internally inconsistent even if one model matches', () => {
    const drift = detectEmbeddingDrift(LIVE_MODEL, [
      LIVE_MODEL,
      MOCK_EMBEDDING_MODEL,
    ])
    expect(drift?.storedModels).toEqual([MOCK_EMBEDDING_MODEL, LIVE_MODEL])
  })

  it('reports nothing when nothing was retrieved', () => {
    // An empty KB is a different problem with its own message.
    expect(detectEmbeddingDrift(LIVE_MODEL, [])).toBeNull()
  })

  it('names both models and the remedy in the message', () => {
    const message = describeEmbeddingDrift({
      queryModel: LIVE_MODEL,
      storedModels: [MOCK_EMBEDDING_MODEL],
    })
    expect(message).toContain(LIVE_MODEL)
    expect(message).toContain(MOCK_EMBEDDING_MODEL)
    expect(message).toContain('pnpm db:seed:policy')
  })
})

describe('which model is "currently configured"', () => {
  it('resolves to the mock id in mock mode, matching what /embed stamps', () => {
    // /config reports models.embed even in mock mode — the mode has to be
    // folded in or the card compares the wrong pair.
    expect(
      effectiveEmbeddingModel({ mode: 'mock', models: { embed: LIVE_MODEL } }),
    ).toBe(MOCK_EMBEDDING_MODEL)
    expect(
      effectiveEmbeddingModel({ mode: 'live', models: { embed: LIVE_MODEL } }),
    ).toBe(LIVE_MODEL)
  })

  it('mirrors Settings.use_mock when derived from env for the migration', () => {
    const live = {
      NIM_MOCK: 'false',
      NVIDIA_API_KEY: 'key',
      NIM_EMBED_MODEL: LIVE_MODEL,
    }
    expect(embeddingModelFromEnv(live)).toBe(LIVE_MODEL)

    // The mock answers whenever the flag is on OR no key is present.
    expect(embeddingModelFromEnv({ ...live, NIM_MOCK: 'true' })).toBe(
      MOCK_EMBEDDING_MODEL,
    )
    expect(embeddingModelFromEnv({ ...live, NVIDIA_API_KEY: '' })).toBe(
      MOCK_EMBEDDING_MODEL,
    )
    expect(embeddingModelFromEnv({})).toBe(MOCK_EMBEDDING_MODEL)
  })
})

describe('embedText', () => {
  it('returns the model id the service stamped alongside the vector', async () => {
    respondWith({ embeddings: [[0.1, 0.2]], model: LIVE_MODEL })
    await expect(embedText('q')).resolves.toEqual({
      vector: [0.1, 0.2],
      model: LIVE_MODEL,
    })
  })

  it('throws rather than proceed when the service sends no model id', async () => {
    // Without it there is no drift check at all — the status quo ante.
    respondWith({ embeddings: [[0.1]] })
    await expect(embedText('q')).rejects.toThrow(/no model id/)
  })
})

describe('retrievePolicy', () => {
  it('returns passages and no drift when the models agree', async () => {
    respondWith({ embeddings: [[0.1]], model: LIVE_MODEL })
    chunkRows.value = [chunk(LIVE_MODEL)]

    const { passages, drift } = await retrievePolicy('how long for TTOs?')
    expect(passages).toHaveLength(1)
    expect(drift).toBeNull()
  })

  it('returns drift when the KB was built by a different model', async () => {
    respondWith({ embeddings: [[0.1]], model: LIVE_MODEL })
    chunkRows.value = [chunk(MOCK_EMBEDDING_MODEL)]

    const { passages, drift } = await retrievePolicy('how long for TTOs?')
    // The rows still come back — that is exactly the danger.
    expect(passages).toHaveLength(1)
    expect(drift).not.toBeNull()
  })
})

describe('answerPolicyQuestion under drift', () => {
  it('refuses, explains, and never claims to be grounded', async () => {
    respondWith({ embeddings: [[0.1]], model: LIVE_MODEL })
    chunkRows.value = [chunk(MOCK_EMBEDDING_MODEL)]

    const result = await answerPolicyQuestion('how long for TTOs?')

    expect(result.embeddingDrift).toBeTruthy()
    expect(result.grounded).toBe(false)
    expect(result.citations).toEqual([])
    expect(result.provenance).not.toBe('live')
    expect(result.answer).toContain('pnpm db:seed:policy')
  })

  it('does not call the answering model at all once drift is known', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: [[0.1]], model: LIVE_MODEL }),
    })
    global.fetch = fetchMock as unknown as typeof fetch
    chunkRows.value = [chunk(null)]

    await answerPolicyQuestion('how long for TTOs?')

    const paths = fetchMock.mock.calls.map((c) => String(c[0]))
    expect(paths).toEqual(['http://ai.test/embed'])
  })
})
