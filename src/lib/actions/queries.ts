import 'server-only'

import { db } from '@/db'
import type { ActionType, RecommendationStatus } from '@/db/schema'

export interface PolicyCite {
  text: string
  source: string
}

export interface QueueRecommendation {
  id: string
  actionType: ActionType
  title: string
  rationale: string
  priority: number
  grounded: boolean
  status: RecommendationStatus
  citations: PolicyCite[]
  barrierType: string | null
}

export interface QueueBed {
  bedLabel: string
  patientName: string | null
  recommendations: QueueRecommendation[]
}

/** Proposed recommendations grouped by bed, highest priority first. */
export async function getActionQueue(): Promise<QueueBed[]> {
  const rows = await db.query.recommendations.findMany({
    where: (r, { eq }) => eq(r.status, 'proposed'),
    orderBy: (r, { asc }) => [asc(r.priority), asc(r.createdAt)],
    with: {
      encounter: { with: { bed: true, patient: true } },
      barrier: true,
    },
  })

  const byBed = new Map<string, QueueBed>()
  for (const r of rows) {
    const label = r.encounter?.bed?.label ?? '—'
    let group = byBed.get(label)
    if (!group) {
      group = {
        bedLabel: label,
        patientName: r.encounter?.patient?.name ?? null,
        recommendations: [],
      }
      byBed.set(label, group)
    }
    group.recommendations.push({
      id: r.id,
      actionType: r.actionType,
      title: r.title,
      rationale: r.rationale,
      priority: r.priority,
      grounded: r.grounded,
      status: r.status,
      citations: Array.isArray(r.policyCitation)
        ? (r.policyCitation as PolicyCite[])
        : [],
      barrierType: r.barrier?.type ?? null,
    })
  }

  return [...byBed.values()].sort((a, b) =>
    a.bedLabel.localeCompare(b.bedLabel),
  )
}

/** Count of proposed recommendations — for the nav badge / board summary. */
export async function getProposedCount(): Promise<number> {
  const rows = await db.query.recommendations.findMany({
    where: (r, { eq }) => eq(r.status, 'proposed'),
    columns: { id: true },
  })
  return rows.length
}
