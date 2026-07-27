import 'server-only'

import { db } from '@/db'
import type { BarrierStatus, BarrierType, BedStatus } from '@/db/schema'

export interface BoardBarrier {
  id: string
  type: BarrierType
  status: BarrierStatus
  quote: string
  confidence: number | null
  noteText: string
  authorRole: string
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
  extracted: boolean
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
  }
}

/**
 * Assembles the current ward board: every bed, its active encounter (patient +
 * denormalised MFFD/EDD), and the grounded barriers with their source citation.
 */
export async function getWardBoard(): Promise<WardBoard | null> {
  const ward = await db.query.wards.findFirst({
    with: {
      beds: {
        orderBy: (b, { asc }) => [asc(b.label)],
        with: {
          encounters: {
            where: (e, { isNull }) => isNull(e.dischargedAt),
            with: {
              patient: true,
              barriers: {
                where: (bar, { ne }) => ne(bar.status, 'cleared'),
                with: { sourceNote: true },
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
      quote: b.sourceQuote,
      confidence: b.confidence,
      noteText: b.sourceNote?.text ?? '',
      authorRole: b.sourceNote?.authorRole ?? 'unknown',
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
      extracted: Boolean(encounter?.lastExtractedAt),
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
  }

  return { wardId: ward.id, wardName: ward.name, beds, stats }
}
