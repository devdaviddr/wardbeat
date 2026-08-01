import { beforeEach, describe, expect, it, vi } from 'vitest'

// The client is `server-only` and reads env at import time; both are stubbed so
// the propagation logic can be exercised in isolation.
const { mockEnv } = vi.hoisted(() => ({
  mockEnv: {
    WARDBEAT_AI_URL: 'http://ai.test',
    WARDBEAT_AI_SERVICE_TOKEN: 'token',
  } as Record<string, unknown>,
}))

vi.mock('@/lib/env', () => ({ env: mockEnv }))

import {
  answerFromPassages,
  extractNote,
  narrateBriefing,
  queryIntent,
  recommendActions,
  routeQuestion,
} from '@/lib/ai/client'
import {
  combineProvenance,
  isModelGenerated,
  PROVENANCE_COPY,
  PROVENANCES,
} from '@/lib/ai/provenance'

/** Stub the next AI-service response. */
function respondWith(body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => body,
  }) as unknown as typeof fetch
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('provenance semantics', () => {
  it('treats only a live response as model-generated', () => {
    expect(isModelGenerated('live')).toBe(true)
    expect(isModelGenerated('mock')).toBe(false)
    expect(isModelGenerated('fallback')).toBe(false)
    expect(isModelGenerated(undefined)).toBe(false)
  })

  it('has distinct copy for each state so mock cannot read as fallback', () => {
    const labels = PROVENANCES.map((p) => PROVENANCE_COPY[p].label)
    expect(new Set(labels).size).toBe(PROVENANCES.length)
  })
})

describe('combineProvenance', () => {
  it('stays live only when every call was live', () => {
    expect(combineProvenance('live', 'live')).toBe('live')
  })

  it('takes the weakest link', () => {
    expect(combineProvenance('live', 'mock')).toBe('mock')
    expect(combineProvenance('live', 'fallback')).toBe('fallback')
    // A broken live call is worse news than a deliberately offline one.
    expect(combineProvenance('mock', 'fallback')).toBe('fallback')
  })

  it('ignores calls that reported nothing', () => {
    expect(combineProvenance('live', undefined)).toBe('live')
    expect(combineProvenance(undefined, 'mock')).toBe('mock')
  })
})

describe('client propagation (service → TypeScript)', () => {
  it('propagates provenance and the model id from /copilot/answer', async () => {
    respondWith({
      answer: 'Four hours.',
      citations: ['p1'],
      grounded: true,
      provenance: 'live',
      model_used: 'nvidia/nemotron',
    })
    const res = await answerFromPassages('q', [
      { id: 'p1', text: 't', source: 's' },
    ])
    expect(res.provenance).toBe('live')
    expect(res.model_used).toBe('nvidia/nemotron')
  })

  it('propagates a fallback answer without losing the model that was called', async () => {
    respondWith({
      answer: 'Four hours.',
      citations: ['p1'],
      grounded: false,
      provenance: 'fallback',
      model_used: 'nvidia/nemotron',
    })
    const res = await answerFromPassages('q', [
      { id: 'p1', text: 't', source: 's' },
    ])
    expect(res.provenance).toBe('fallback')
    expect(res.model_used).toBe('nvidia/nemotron')
  })

  it('reads mock provenance with a null model id', async () => {
    respondWith({
      answer: 'x',
      citations: [],
      grounded: false,
      provenance: 'mock',
      model_used: null,
    })
    const res = await answerFromPassages('q', [
      { id: 'p1', text: 't', source: 's' },
    ])
    expect(res.provenance).toBe('mock')
    expect(res.model_used).toBeNull()
  })

  it('rejects a response with no provenance rather than assuming it is live', async () => {
    respondWith({ answer: 'x', citations: [], grounded: true })
    await expect(
      answerFromPassages('q', [{ id: 'p1', text: 't', source: 's' }]),
    ).rejects.toThrow()
  })

  it('rejects an unknown provenance value', async () => {
    respondWith({
      answer: 'x',
      citations: [],
      grounded: true,
      provenance: 'probably-fine',
    })
    await expect(
      answerFromPassages('q', [{ id: 'p1', text: 't', source: 's' }]),
    ).rejects.toThrow()
  })

  it('propagates provenance from /copilot/route', async () => {
    respondWith({ path: 'policy', provenance: 'fallback', model_used: 'm' })
    expect(await routeQuestion('q')).toEqual({
      path: 'policy',
      provenance: 'fallback',
    })
  })

  it('narrows an unknown route to out_of_scope but keeps its provenance', async () => {
    respondWith({ path: 'nonsense', provenance: 'mock', model_used: null })
    expect(await routeQuestion('q')).toEqual({
      path: 'out_of_scope',
      provenance: 'mock',
    })
  })

  it('unwraps the nested intent from /copilot/query-intent', async () => {
    respondWith({
      intent: { aggregation: 'count', free: true },
      provenance: 'mock',
      model_used: null,
    })
    const res = await queryIntent('how many beds are free?')
    expect(res.intent).toEqual({ aggregation: 'count', free: true })
    expect(res.provenance).toBe('mock')
  })

  it('propagates provenance from /agent/recommend', async () => {
    respondWith({
      recommendations: [
        {
          barrier_id: 'b1',
          action_type: 'chase_tto',
          title: 'Chase TTOs',
          rationale: 'r',
          priority: 1,
          citations: [1],
          grounded: false,
        },
      ],
      provenance: 'fallback',
      model_used: 'm',
    })
    const res = await recommendActions('Bed 1', [], [])
    expect(res.provenance).toBe('fallback')
    expect(res.recommendations).toHaveLength(1)
    expect(res.recommendations[0]!.grounded).toBe(false)
  })

  it('propagates provenance from /forecast/narrate', async () => {
    respondWith({
      briefing: 'Ward is 3 beds short.',
      provenance: 'mock',
      model_used: null,
    })
    const res = await narrateBriefing({
      stats: {},
      at_risk: [],
      predicted_discharges: [],
    })
    expect(res.provenance).toBe('mock')
    expect(res.briefing).toBe('Ward is 3 beds short.')
  })

  it('propagates provenance from /extract', async () => {
    respondWith({
      note_id: 'n1',
      model: 'mock',
      mffd_flag: true,
      barriers: [],
      escalations: [],
      grounded: true,
      provenance: 'mock',
      model_used: null,
    })
    const res = await extractNote({ noteId: 'n1', text: 'note' })
    expect(res.provenance).toBe('mock')
    expect(res.model_used).toBeNull()
  })
})
