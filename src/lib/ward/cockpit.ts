import 'server-only'

import { db } from '@/db'
import type { ActionType } from '@/db/schema'
import { forecastDischarge } from '@/lib/ai/client'
import { logger } from '@/lib/logger'
import { getWardBoard, type BoardBed, type WardBoard } from '@/lib/ward/queries'

export interface CockpitRecommendation {
  id: string
  actionType: ActionType
  title: string
  rationale: string
  priority: number
  grounded: boolean
  citations: Array<{ text: string; source: string }>
}

export interface CockpitBed extends BoardBed {
  pDischarge: number | null
  predictedDays: number | null
  recommendations: CockpitRecommendation[]
  actionCount: number
}

export interface Cockpit {
  wardId: string
  wardName: string
  stats: WardBoard['stats']
  beds: CockpitBed[]
}

/**
 * The board plus, per bed, its proposed recommendations and discharge forecast —
 * assembled in one cheap pass (one recommendations query + one local forecast
 * batch, NO NIM). The narrated briefing is loaded separately/async so this never
 * blocks on a model call.
 */
export async function getCockpit(): Promise<Cockpit | null> {
  const board = await getWardBoard()
  if (!board) return null

  // Proposed recommendations, grouped by encounter.
  const recRows = await db.query.recommendations.findMany({
    where: (r, { eq }) => eq(r.status, 'proposed'),
    orderBy: (r, { asc }) => [asc(r.priority), asc(r.createdAt)],
  })
  const recsByEncounter = new Map<string, CockpitRecommendation[]>()
  for (const r of recRows) {
    const list = recsByEncounter.get(r.encounterId) ?? []
    list.push({
      id: r.id,
      actionType: r.actionType,
      title: r.title,
      rationale: r.rationale,
      priority: r.priority,
      grounded: r.grounded,
      citations: Array.isArray(r.policyCitation)
        ? (r.policyCitation as Array<{ text: string; source: string }>)
        : [],
    })
    recsByEncounter.set(r.encounterId, list)
  }

  // Discharge forecast for occupied beds — deterministic, no NIM. Degrade to
  // null if the ai service is unavailable so the board still renders.
  const occupied = board.beds.filter((b) => b.occupied && b.encounterId)
  const forecastById = new Map<string, { p: number; days: number }>()
  try {
    if (occupied.length) {
      const forecasts = await forecastDischarge(
        occupied.map((b) => ({
          id: b.id,
          mffd: b.mffd,
          open_barriers: b.barriers.length,
          has_transport: b.barriers.some((x) => x.type === 'transport'),
          has_social_care: b.barriers.some((x) => x.type === 'social_care'),
          has_review: b.barriers.some((x) => x.type === 'review'),
          days_admitted: 3,
          edd_set: Boolean(b.edd),
        })),
      )
      for (const f of forecasts) {
        forecastById.set(f.id, {
          p: f.p_discharge_24h,
          days: f.predicted_days,
        })
      }
    }
  } catch (err) {
    logger.warn('cockpit forecast unavailable', {
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const beds: CockpitBed[] = board.beds.map((bed) => {
    const recs = bed.encounterId
      ? (recsByEncounter.get(bed.encounterId) ?? [])
      : []
    const f = forecastById.get(bed.id)
    return {
      ...bed,
      recommendations: recs,
      actionCount: recs.length,
      pDischarge: f?.p ?? null,
      predictedDays: f?.days ?? null,
    }
  })

  return {
    wardId: board.wardId,
    wardName: board.wardName,
    stats: board.stats,
    beds,
  }
}
