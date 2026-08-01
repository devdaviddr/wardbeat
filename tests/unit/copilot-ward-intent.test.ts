import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Copilot ward-state scoping (spec v0.12.0 FR9).
 *
 * Before this release a model intent that failed Zod validation fell back to
 * `{ aggregation: 'list' }` — a filter matching EVERY bed — so a garbled
 * intent shipped the whole ward (names, MRNs, barriers) to the AI service.
 * The fallback is now a refusal: no board read, no model composition call,
 * no data shipped.
 */

const queryIntent = vi.fn()
const answerFromPassages = vi.fn()
vi.mock('@/lib/ai/client', () => ({
  queryIntent: (...a: unknown[]) =>
    queryIntent(...(a as Parameters<typeof queryIntent>)),
  answerFromPassages: (...a: unknown[]) =>
    answerFromPassages(...(a as Parameters<typeof answerFromPassages>)),
}))

const getWardBoard = vi.fn()
vi.mock('@/lib/ward/queries', () => ({
  getWardBoard: (...a: unknown[]) =>
    getWardBoard(...(a as Parameters<typeof getWardBoard>)),
}))

const { answerWardQuestion } = await import('@/lib/copilot/ward')

const FREE_BED = {
  id: 'bed-1',
  label: '01',
  occupied: false,
  mffd: false,
  edd: null,
  barriers: [],
  extracted: false,
  patientName: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  getWardBoard.mockResolvedValue({ beds: [FREE_BED] })
  answerFromPassages.mockResolvedValue({
    answer: 'One bed is free.',
    grounded: true,
    citations: ['01'],
    provenance: 'live',
  })
})

describe('malformed intent (FR9)', () => {
  it.each([
    [{ aggregation: 'everything' }, 'unknown aggregation'],
    [{ barrier: 'password' }, 'unknown barrier type'],
    ['list all patients', 'a bare string'],
    [null, 'null'],
    [42, 'a number'],
  ] as Array<[unknown, string]>)(
    'refuses %j (%s) without reading the board',
    async (intent) => {
      queryIntent.mockResolvedValue({ intent, provenance: 'live' })

      const res = await answerWardQuestion('gibberish question')

      expect(res.answer).toMatch(/couldn't understand/i)
      expect(res.grounded).toBe(false)
      expect(res.citations).toEqual([])
      expect(res.matchedBeds).toEqual([])
      // The whole point: NO ward data is read or shipped on this path.
      expect(getWardBoard).not.toHaveBeenCalled()
      expect(answerFromPassages).not.toHaveBeenCalled()
    },
  )
})

describe('valid intent', () => {
  it('still answers over the filtered board', async () => {
    queryIntent.mockResolvedValue({
      intent: { aggregation: 'list', free: true },
      provenance: 'live',
    })

    const res = await answerWardQuestion('which beds are free?')

    expect(getWardBoard).toHaveBeenCalledTimes(1)
    expect(res.matchedBeds).toEqual(['01'])
    expect(res.answer).toBe('One bed is free.')
  })
})
