import 'server-only'

import {
  forecastDemand,
  forecastDischarge,
  narrateBriefing,
} from '@/lib/ai/client'
import type { Provenance } from '@/lib/ai/provenance'
import { countRecentAdmissions } from '@/lib/ward/demand'
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
    /**
     * Projected from the ward's own trailing-7-day admission history, or
     * `null` when there is not enough of it. **Never** rendered as a number
     * when null — the briefing says why instead (spec v0.11.0 FR2/FR3). The
     * previous `0.5/hr` synthetic constant made this always 6.
     */
    expectedAdmissions: number | null
    /** Null whenever `expectedAdmissions` is: a net position needs it. */
    netBeds: number | null
    windowHours: number
  }
  /** Plain-English reason the demand figures are absent; null when present. */
  demandUnavailableReason: string | null
  /** The basis for the projection, so the UI can show its working. */
  admissionsLast7d: number | null
  predictedDischarges: PredictedDischarge[]
  atRisk: Array<{ label: string; barriers: string[] }>
  briefing: string
  /** Applies to the narrated prose only — the figures above it are computed by
   *  the deterministic forecasts either way. */
  provenance: Provenance
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
    // Real length of stay from `encounters.admittedAt`, or null when the
    // encounter has none — never a constant (spec v0.11.0 FR1).
    days_admitted: b.daysAdmitted,
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

  // Demand is projected from this ward's own admission history. The service
  // decides whether the history is thick enough; we only count it honestly,
  // including counting none.
  const admissionsLast7d = await countRecentAdmissions()
  const demand = await forecastDemand({
    free_beds: board.stats.free,
    predicted_discharges: predicted24h,
    admissions_last_7d: admissionsLast7d,
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

  // Omit-not-invent: a figure we could not compute is left out of the payload
  // entirely rather than sent as 0, so there is nothing for the narrator to
  // state (spec v0.11.0 FR3). The reason goes with it so it can say why.
  const narration = await narrateBriefing({
    stats: {
      occupied: stats.occupied,
      free: stats.free,
      mffd_delayed: stats.mffdDelayed,
      predicted_discharges_24h: stats.predictedDischarges24h,
      ...(stats.expectedAdmissions !== null
        ? { expected_admissions: stats.expectedAdmissions }
        : {}),
      ...(stats.netBeds !== null ? { net_beds: stats.netBeds } : {}),
      window_hours: stats.windowHours,
    },
    demand_unavailable_reason: demand.reason,
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
    demandUnavailableReason: demand.reason,
    admissionsLast7d: demand.admissions_last_7d,
    predictedDischarges,
    atRisk,
    briefing: narration.briefing,
    provenance: narration.provenance,
  }
}
