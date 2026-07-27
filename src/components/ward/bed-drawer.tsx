'use client'

import { useEffect, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  approveRecommendationAction,
  dismissRecommendationAction,
} from '@/lib/actions/decide'
import type { CockpitBed } from '@/lib/ward/cockpit'

const BARRIER_LABELS: Record<string, string> = {
  tto: 'TTO / meds',
  transport: 'Transport',
  social_care: 'Social care',
  review: 'Review',
  other: 'Other',
}
const ACTION_LABELS: Record<string, string> = {
  chase_tto: 'Chase TTOs',
  book_transport: 'Book transport',
  arrange_social_care: 'Arrange social care',
  escalate_review: 'Escalate review',
  other: 'Action',
}

export function BedDrawer({
  bed,
  onClose,
  onChanged,
}: {
  bed: CockpitBed | null
  onClose: () => void
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  if (!bed) return null

  function decide(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
  ) {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      setMsg(r.ok ? ok : (r.error ?? 'Something went wrong.'))
      onChanged()
    })
  }

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

            {/* Barriers */}
            <section>
              <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                Barriers ({bed.barriers.length})
              </h3>
              {bed.barriers.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {bed.extracted ? 'No open barriers.' : 'Not yet analysed.'}
                </p>
              ) : (
                <ul className="space-y-2">
                  {bed.barriers.map((b) => (
                    <li key={b.id} className="rounded border p-2 text-sm">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge variant="outline" className="border-amber-400">
                          {BARRIER_LABELS[b.type] ?? b.type}
                        </Badge>
                      </div>
                      <details className="text-muted-foreground text-xs">
                        <summary className="cursor-pointer">
                          &ldquo;{b.quote}&rdquo;
                        </summary>
                        <p className="mt-1 leading-relaxed">
                          From the {b.authorRole} note: {b.noteText}
                        </p>
                      </details>
                    </li>
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
                  None pending. Generate from the Actions queue.
                </p>
              ) : (
                <ul className="space-y-2">
                  {bed.recommendations.map((r) => (
                    <li key={r.id} className="bg-card rounded-lg border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">
                          {ACTION_LABELS[r.actionType] ?? 'Action'}
                        </Badge>
                        {r.priority === 1 && (
                          <Badge variant="destructive" className="text-[10px]">
                            Priority
                          </Badge>
                        )}
                        <span
                          className={`text-[10px] ${r.grounded ? 'text-green-600' : 'text-amber-600'}`}
                        >
                          {r.grounded ? '● grounded' : '○ no policy'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm font-medium">{r.title}</p>
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {r.rationale}
                      </p>
                      {r.citations.length > 0 && (
                        <details className="mt-1 text-xs">
                          <summary className="text-muted-foreground cursor-pointer">
                            Policy ({r.citations.length})
                          </summary>
                          {r.citations.map((c, i) => (
                            <blockquote
                              key={i}
                              className="border-primary bg-muted/40 mt-1 rounded border-l-2 p-2 leading-relaxed"
                            >
                              {c.text}
                              <span className="text-muted-foreground">
                                {' '}
                                — {c.source}
                              </span>
                            </blockquote>
                          ))}
                        </details>
                      )}
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            decide(
                              () => approveRecommendationAction(r.id),
                              'Approved — barrier marked in progress.',
                            )
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
                            decide(
                              () => dismissRecommendationAction(r.id),
                              'Dismissed.',
                            )
                          }
                        >
                          Dismiss
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {msg && (
                <p className="mt-2 text-sm" role="status">
                  {msg}
                </p>
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
