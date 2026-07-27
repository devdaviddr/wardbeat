import 'server-only'

import { z } from 'zod'

import { answerFromPassages, queryIntent } from '@/lib/ai/client'
import { getWardBoard, type BoardBed } from '@/lib/ward/queries'

/**
 * Ward-state Q&A. The model returns a STRUCTURED FILTER (never SQL); we validate
 * it against a fixed allow-list, apply it to the live board in memory (zero
 * injection surface), then have the model compose a grounded answer citing the
 * matched beds.
 */

// The only shape the app will honour — anything else the model emits is dropped.
const intentSchema = z.object({
  aggregation: z.enum(['list', 'count']).default('list'),
  mffd: z.boolean().optional(),
  free: z.boolean().optional(),
  barrier: z
    .enum(['tto', 'transport', 'social_care', 'review', 'any'])
    .optional(),
  edd_today: z.boolean().optional(),
})
export type WardQueryIntent = z.infer<typeof intentSchema>

export interface WardAnswer {
  answer: string
  grounded: boolean
  citations: string[] // bed labels
  matchedBeds: string[]
  intent: WardQueryIntent
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function applyIntent(beds: BoardBed[], intent: WardQueryIntent): BoardBed[] {
  const today = todayIso()
  return beds.filter((bed) => {
    if (intent.free !== undefined && bed.occupied === intent.free) return false
    // Every remaining filter concerns an occupied bed.
    if (intent.free === false || intent.mffd !== undefined || intent.barrier) {
      if (!bed.occupied) return false
    }
    if (intent.mffd !== undefined && bed.mffd !== intent.mffd) return false
    if (intent.barrier === 'any' && bed.barriers.length === 0) return false
    if (
      intent.barrier &&
      intent.barrier !== 'any' &&
      !bed.barriers.some((b) => b.type === intent.barrier)
    ) {
      return false
    }
    if (intent.edd_today && bed.edd !== today) return false
    return true
  })
}

function bedRecord(bed: BoardBed): string {
  const bits = [`Bed ${bed.label}`]
  if (bed.occupied) {
    bits.push(bed.patientName ?? 'occupied')
    bits.push(bed.mffd ? 'medically fit for discharge' : 'inpatient')
    if (bed.edd) bits.push(`EDD ${bed.edd}`)
    if (bed.barriers.length)
      bits.push(`barriers: ${bed.barriers.map((b) => b.type).join(', ')}`)
    else if (bed.extracted) bits.push('no barriers')
  } else {
    bits.push('free')
  }
  return bits.join(' — ')
}

export async function answerWardQuestion(
  question: string,
): Promise<WardAnswer> {
  const parsed = intentSchema.safeParse(await queryIntent(question))
  const intent: WardQueryIntent = parsed.success
    ? parsed.data
    : { aggregation: 'list' }

  const board = await getWardBoard()
  const beds = board ? applyIntent(board.beds, intent) : []
  const matchedBeds = beds.map((b) => b.label)

  if (beds.length === 0) {
    return {
      answer: 'No beds match that.',
      grounded: false,
      citations: [],
      matchedBeds: [],
      intent,
    }
  }

  const result = await answerFromPassages(
    question,
    beds.map((b) => ({ id: b.label, text: bedRecord(b), source: 'ward' })),
    'ward',
  )

  return {
    answer: result.answer,
    grounded: result.grounded,
    citations: result.citations,
    matchedBeds,
    intent,
  }
}
