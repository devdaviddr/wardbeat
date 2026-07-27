import 'server-only'

import {
  forecastDemand,
  forecastDischarge,
  narrateBriefing,
} from '@/lib/ai/client'
import { getWardBoard } from '@/lib/ward/queries'

/**
 * Flow briefing: deterministic forecasts (discharge + demand) narrated by the
 * LLM. The models produce every number; the LLM only turns them into prose —
 * "ML predicts, LLM narrates". Returns null if there's no ward seeded.
 */

const WINDOW_HOURS = 12
const DISCHARGE_THRESHOLD = 0.5

export interface PredictedDischarge {
  label: string
  patientName: string | null
  p: number
  predictedDays: number
}

export interface FlowBriefing {
  wardName: string
  stats: {
    occupied: number
    free: number
    mffdDelayed: number
    predictedDischarges24h: number
    expectedAdmissions: number
    netBeds: number
    windowHours: number
  }
  predictedDischarges: PredictedDischarge[]
  atRisk: Array<{ label: string; barriers: string[] }>
  briefing: string
}

export async function getFlowBriefing(): Promise<FlowBriefing | null> {
  const board = await getWardBoard()
  if (!board) return null

  const occupied = board.beds.filter((b) => b.occupied && b.encounterId)

  const features = occupied.map((b) => ({
    id: b.id,
    mffd: b.mffd,
    open_barriers: b.barriers.length,
    has_transport: b.barriers.some((x) => x.type === 'transport'),
    has_social_care: b.barriers.some((x) => x.type === 'social_care'),
    has_review: b.barriers.some((x) => x.type === 'review'),
    days_admitted: 3, // synthetic constant; a real feed would supply LoS
    edd_set: Boolean(b.edd),
  }))

  const forecasts = features.length ? await forecastDischarge(features) : []
  const pById = new Map(forecasts.map((f) => [f.id, f]))

  const predictedDischarges: PredictedDischarge[] = occupied
    .map((b) => {
      const f = pById.get(b.id)
      return {
        label: b.label,
        patientName: b.patientName,
        p: f?.p_discharge_24h ?? 0,
        predictedDays: f?.predicted_days ?? 0,
      }
    })
    .sort((a, b) => b.p - a.p)

  const predicted24h = predictedDischarges.filter(
    (d) => d.p >= DISCHARGE_THRESHOLD,
  ).length

  const demand = await forecastDemand({
    free_beds: board.stats.free,
    predicted_discharges: predicted24h,
    window_hours: WINDOW_HOURS,
  })

  const atRisk = board.beds
    .filter((b) => b.occupied && b.mffd && b.barriers.length > 0)
    .map((b) => ({
      label: b.label,
      barriers: [...new Set(b.barriers.map((x) => x.type))],
    }))

  const stats = {
    occupied: board.stats.occupied,
    free: board.stats.free,
    mffdDelayed: board.stats.mffdDelayed,
    predictedDischarges24h: predicted24h,
    expectedAdmissions: demand.expected_admissions,
    netBeds: demand.net_beds,
    windowHours: WINDOW_HOURS,
  }

  const { briefing } = await narrateBriefing({
    stats: {
      occupied: stats.occupied,
      free: stats.free,
      mffd_delayed: stats.mffdDelayed,
      predicted_discharges_24h: stats.predictedDischarges24h,
      expected_admissions: stats.expectedAdmissions,
      net_beds: stats.netBeds,
      window_hours: stats.windowHours,
    },
    at_risk: atRisk,
    predicted_discharges: predictedDischarges
      .filter((d) => d.p >= DISCHARGE_THRESHOLD)
      .map((d) => ({
        label: d.label,
        p: d.p,
        predicted_days: d.predictedDays,
      })),
  })

  return {
    wardName: board.wardName,
    stats,
    predictedDischarges,
    atRisk,
    briefing,
  }
}
