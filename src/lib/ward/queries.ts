import 'server-only'

import { db } from '@/db'
import type {
  BarrierEventKind,
  BarrierOrigin,
  BarrierStatus,
  BarrierType,
  BedStatus,
  EddSource,
} from '@/db/schema'

export interface BarrierEventEntry {
  id: string
  kind: BarrierEventKind
  actorName: string | null
  body: string | null
  createdAt: Date
}

export interface BoardBarrier {
  id: string
  type: BarrierType
  status: BarrierStatus
  origin: BarrierOrigin
  quote: string
  /** Free text for clinician-raised barriers; AI barriers use `quote`. */
  description: string | null
  confidence: number | null
  noteText: string
  authorRole: string
  ownerUserId: string | null
  ownerName: string | null
  dueAt: Date | null
  /** Assigned, past its due time, still open — the escalation cue. */
  overdue: boolean
  /**
   * When this barrier was first seen. Survives re-extraction since v0.10.0, so
   * "waiting two days on transport" is finally answerable.
   */
  firstSeenAt: Date
  ageDays: number
  /** The notes no longer support this barrier, but nobody has resolved it. */
  unconfirmed: boolean
  clearedReason: string | null
  events: BarrierEventEntry[]
}

export interface BoardBed {
  id: string
  label: string
  status: BedStatus
  occupied: boolean
  patientName: string | null
  mrn: string | null
  encounterId: string | null
  mffd: boolean
  edd: string | null
  /** Whether the current EDD was set by a clinician or read out of the notes. */
  eddSource: EddSource
  eddSetByName: string | null
  extracted: boolean
  lastExtractedAt: Date | null
  barriers: BoardBarrier[]
}

export interface WardBoard {
  wardId: string
  wardName: string
  beds: BoardBed[]
  stats: {
    total: number
    occupied: number
    free: number
    mffdDelayed: number // fit for discharge but still has open barriers
    unprocessed: number // occupied beds not yet run through extraction
    overdue: number // assigned barriers past their due time
  }
  /** Most recent extraction across the ward, so staff can calibrate trust. */
  lastExtractedAt: Date | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function ageInDays(from: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS))
}

/**
 * Assembles the current ward board: every bed, its active encounter (patient +
 * denormalised MFFD/EDD), and the grounded barriers with their source citation.
 */
export async function getWardBoard(
  now: Date = new Date(),
): Promise<WardBoard | null> {
  const ward = await db.query.wards.findFirst({
    with: {
      beds: {
        orderBy: (b, { asc }) => [asc(b.label)],
        with: {
          encounters: {
            where: (e, { isNull }) => isNull(e.dischargedAt),
            with: {
              patient: true,
              eddSetBy: true,
              barriers: {
                // `cleared` and `dismissed` are both resolved — neither belongs
                // on the open board. Before v0.10.0 nothing could reach either
                // state, so this filter never actually removed anything.
                where: (bar, { notInArray }) =>
                  notInArray(bar.status, ['cleared', 'dismissed']),
                with: {
                  sourceNote: true,
                  owner: true,
                  events: {
                    orderBy: (e, { asc }) => [asc(e.createdAt)],
                    with: { actor: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  })

  if (!ward) return null

  const beds: BoardBed[] = ward.beds.map((bed) => {
    const encounter = bed.encounters[0] ?? null
    const barriers: BoardBarrier[] = (encounter?.barriers ?? []).map((b) => ({
      id: b.id,
      type: b.type,
      status: b.status,
      origin: b.origin,
      quote: b.sourceQuote,
      description: b.description,
      confidence: b.confidence,
      noteText: b.sourceNote?.text ?? '',
      authorRole: b.sourceNote?.authorRole ?? 'unknown',
      ownerUserId: b.ownerUserId,
      ownerName: b.owner?.name ?? b.owner?.email ?? null,
      dueAt: b.dueAt,
      overdue: Boolean(b.dueAt && b.dueAt < now),
      firstSeenAt: b.firstSeenAt,
      ageDays: ageInDays(b.firstSeenAt, now),
      unconfirmed: b.unconfirmedAt !== null,
      clearedReason: b.clearedReason,
      events: (b.events ?? []).map((e) => ({
        id: e.id,
        kind: e.kind,
        actorName: e.actor?.name ?? e.actor?.email ?? null,
        body: e.body,
        createdAt: e.createdAt,
      })),
    }))

    return {
      id: bed.id,
      label: bed.label,
      status: bed.status,
      occupied: Boolean(encounter),
      patientName: encounter?.patient?.name ?? null,
      mrn: encounter?.patient?.mrn ?? null,
      encounterId: encounter?.id ?? null,
      mffd: encounter?.mffdFlag ?? false,
      edd: encounter?.edd ?? null,
      eddSource: encounter?.eddSource ?? 'ai',
      eddSetByName:
        encounter?.eddSetBy?.name ?? encounter?.eddSetBy?.email ?? null,
      extracted: Boolean(encounter?.lastExtractedAt),
      lastExtractedAt: encounter?.lastExtractedAt ?? null,
      barriers,
    }
  })

  const occupiedBeds = beds.filter((b) => b.occupied)
  const stats = {
    total: beds.length,
    occupied: occupiedBeds.length,
    free: beds.length - occupiedBeds.length,
    mffdDelayed: occupiedBeds.filter((b) => b.mffd && b.barriers.length > 0)
      .length,
    unprocessed: occupiedBeds.filter((b) => !b.extracted).length,
    overdue: beds.reduce(
      (n, b) => n + b.barriers.filter((bar) => bar.overdue).length,
      0,
    ),
  }

  const lastExtractedAt = beds.reduce<Date | null>((latest, bed) => {
    if (!bed.lastExtractedAt) return latest
    return !latest || bed.lastExtractedAt > latest
      ? bed.lastExtractedAt
      : latest
  }, null)

  return { wardId: ward.id, wardName: ward.name, beds, stats, lastExtractedAt }
}
