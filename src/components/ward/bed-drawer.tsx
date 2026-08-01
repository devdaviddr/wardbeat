'use client'

import { useEffect } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { logBedViewAction } from '@/lib/audit/log-view'
import type { CockpitBed, CockpitCapabilities } from '@/lib/ward/cockpit'
import type { Assignee } from '@/lib/ward/people'

import { AddBarrier } from './add-barrier'
import { BarrierRecord } from './barrier-record'
import { EddEditor } from './edd-editor'
import { RecommendationCard } from './recommendation-card'

export function BedDrawer({
  bed,
  people,
  capabilities,
  onClose,
  onChanged,
}: {
  bed: CockpitBed | null
  people: Assignee[]
  /** Hides affordances the user cannot use; server actions re-check. */
  capabilities: CockpitCapabilities
  onClose: () => void
  onChanged: () => void
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Access audit (spec v0.12.0 FR5): opening a bed with a patient records who
  // looked at which patient. Fire-and-forget — never blocks or breaks the UI.
  const viewedEncounterId = bed?.occupied ? (bed.encounterId ?? null) : null
  useEffect(() => {
    if (viewedEncounterId) void logBedViewAction(viewedEncounterId)
  }, [viewedEncounterId])

  if (!bed) return null

  const pct =
    bed.pDischarge != null ? `${Math.round(bed.pDischarge * 100)}%` : '—'

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Bed ${bed.label} detail`}
        className="bg-background absolute top-0 right-0 flex h-full w-full max-w-md flex-col overflow-y-auto border-l shadow-xl"
      >
        <header className="flex items-start justify-between border-b p-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-bold">{bed.label}</span>
              {!bed.occupied ? (
                <Badge variant="outline">Free</Badge>
              ) : bed.mffd ? (
                <Badge variant="success">MFFD</Badge>
              ) : (
                <Badge variant="secondary">Inpatient</Badge>
              )}
            </div>
            {bed.occupied && (
              <p className="mt-1 text-sm font-medium">{bed.patientName}</p>
            )}
            {bed.occupied && (
              <p className="text-muted-foreground text-xs">
                {bed.mrn}
                {bed.edd ? ` · EDD ${bed.edd}` : ''}
              </p>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>

        {bed.occupied ? (
          <div className="flex-1 space-y-5 p-4">
            {/* Forecast */}
            <section>
              <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                Discharge forecast
              </h3>
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="font-mono text-xl font-bold tabular-nums">
                    {pct}
                  </span>
                  <span className="text-muted-foreground ml-1 text-xs">
                    P(discharge 24h)
                  </span>
                </div>
                {bed.predictedDays != null && (
                  <div>
                    <span className="font-mono text-xl font-bold tabular-nums">
                      {bed.predictedDays}d
                    </span>
                    <span className="text-muted-foreground ml-1 text-xs">
                      predicted stay
                    </span>
                  </div>
                )}
              </div>
            </section>

            {/* Discharge date — clinician-overridable */}
            {bed.encounterId && (
              <EddEditor
                encounterId={bed.encounterId}
                edd={bed.edd}
                source={bed.eddSource}
                setByName={bed.eddSetByName}
                canEdit={capabilities.canOverrideEdd}
                onChanged={onChanged}
              />
            )}

            {/* Barriers */}
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  Barriers ({bed.barriers.length})
                </h3>
                {bed.encounterId && capabilities.canCreateBarrier && (
                  <AddBarrier
                    encounterId={bed.encounterId}
                    onChanged={onChanged}
                  />
                )}
              </div>
              {bed.barriers.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {bed.extracted ? 'No open barriers.' : 'Not yet analysed.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {bed.barriers.map((b) => (
                    <BarrierRecord
                      key={b.id}
                      barrier={b}
                      people={people}
                      canAssignComment={capabilities.canAssignComment}
                      canClear={capabilities.canClear}
                      onChanged={onChanged}
                    />
                  ))}
                </ul>
              )}
            </section>

            {/* Recommendations */}
            <section>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                Recommended actions ({bed.recommendations.length})
              </h3>
              {bed.recommendations.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  None pending. Use <span className="font-medium">Actions</span>{' '}
                  on the board to generate them.
                </p>
              ) : (
                <div className="space-y-2">
                  {bed.recommendations.map((r) => (
                    <RecommendationCard
                      key={r.id}
                      rec={r}
                      canDecide={capabilities.canApprove}
                      onChanged={onChanged}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="text-muted-foreground flex-1 p-4 text-sm">
            This bed is free.
          </div>
        )}
      </aside>
    </div>
  )
}
