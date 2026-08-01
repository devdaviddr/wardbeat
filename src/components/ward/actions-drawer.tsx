'use client'

import { useEffect, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { generateRecommendationsAction } from '@/lib/actions/generate'
import { isModelGenerated, PROVENANCE_COPY } from '@/lib/ai/provenance'
import type { Cockpit } from '@/lib/ward/cockpit'

import { RecommendationCard } from './recommendation-card'

/**
 * The action queue as a board slide-over (replaces the standalone /actions page).
 * Lists pending recommendations grouped by bed, with a Generate button.
 */
export function ActionsDrawer({
  cockpit,
  open,
  onClose,
  onChanged,
}: {
  cockpit: Cockpit
  open: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  if (!open) return null

  const bedsWithRecs = cockpit.beds.filter((b) => b.recommendations.length > 0)
  const total = bedsWithRecs.reduce((n, b) => n + b.recommendations.length, 0)

  function generate() {
    setStatus(null)
    startTransition(async () => {
      const r = await generateRecommendationsAction()
      setStatus(
        r.ok
          ? `Generated ${r.generated} action(s) for ${r.patients} patient(s).` +
              // Stored recommendations carry no provenance column yet, so this
              // is the only point at which the batch can be labelled honestly.
              (r.generated > 0 && !isModelGenerated(r.provenance)
                ? ` ${PROVENANCE_COPY[r.provenance].detail}`
                : '')
          : `Failed: ${r.error ?? 'unknown error'}`,
      )
      onChanged()
    })
  }

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
        aria-label="Action queue"
        className="bg-background absolute top-0 right-0 flex h-full w-full max-w-md flex-col overflow-y-auto border-l shadow-xl"
      >
        <header className="flex items-start justify-between border-b p-4">
          <div>
            <h2 className="text-lg font-semibold">Action queue</h2>
            <p className="text-muted-foreground text-xs">
              {total} recommended action{total === 1 ? '' : 's'} awaiting
              approval. Nothing happens until you approve.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </header>

        <div className="flex items-center gap-3 border-b p-4">
          <Button size="sm" onClick={generate} disabled={pending}>
            {pending ? 'Working…' : 'Generate recommendations'}
          </Button>
          {status && (
            <span className="text-muted-foreground text-xs" role="status">
              {status}
            </span>
          )}
        </div>

        <div className="flex-1 space-y-5 p-4">
          {total === 0 ? (
            <p className="text-muted-foreground text-sm">
              No actions to review. Run extraction on the board, then{' '}
              <span className="font-medium">Generate recommendations</span>.
            </p>
          ) : (
            bedsWithRecs.map((bed) => (
              <section key={bed.id} className="space-y-2">
                <h3 className="text-sm font-semibold">
                  <span className="font-mono">{bed.label}</span>
                  {bed.patientName ? ` · ${bed.patientName}` : ''}
                </h3>
                {bed.recommendations.map((r) => (
                  <RecommendationCard
                    key={r.id}
                    rec={r}
                    onChanged={onChanged}
                  />
                ))}
              </section>
            ))
          )}
        </div>
      </aside>
    </div>
  )
}
