'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ProvenanceBadge } from '@/components/ward/provenance-badge'
import { isModelGenerated, PROVENANCE_COPY } from '@/lib/ai/provenance'
import { getBriefingSummaryAction } from '@/lib/briefing/actions'
import type { FlowBriefing } from '@/lib/briefing/briefing'

/**
 * The flow briefing. It's the one NIM call on the board and takes a few seconds,
 * so it's **manual** — the board loads instantly and the briefing is generated
 * on demand.
 */
export function BriefingStrip() {
  const [data, setData] = useState<FlowBriefing | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  function generate() {
    setState('loading')
    getBriefingSummaryAction()
      .then((r) => {
        if (r.ok && r.briefing) {
          setData(r.briefing)
          setError(null)
          setState('done')
        } else {
          setError(r.ok ? null : r.error)
          setState('error')
        }
      })
      .catch(() => {
        setError(null)
        setState('error')
      })
  }

  if (state === 'loading') {
    return (
      <div className="bg-muted/40 text-muted-foreground animate-pulse rounded-lg border p-3 text-sm">
        Generating flow briefing… (forecasts + one narration call)
      </div>
    )
  }

  if (state === 'idle' || !data) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
        <span className="text-muted-foreground">
          {state === 'error'
            ? (error ?? "Couldn't generate the briefing.")
            : 'Flow briefing — net bed position + a narrated shift summary.'}
        </span>
        <Button size="sm" variant="outline" onClick={generate}>
          {state === 'error' ? 'Retry' : 'Generate briefing'}
        </Button>
      </div>
    )
  }

  const { netBeds, expectedAdmissions } = data.stats
  // A net bed position needs a demand projection. Without one there is no
  // honest number to bold, so the strip states the absence instead of
  // defaulting to a figure a bed manager could act on (spec v0.11.0 FR3).
  const short = netBeds !== null && netBeds < 0

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {netBeds === null ? (
          <span className="text-muted-foreground font-medium">
            Net bed position unavailable
          </span>
        ) : (
          <span
            className={`font-mono font-bold ${short ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}
          >
            Net {short ? `${Math.abs(netBeds)} short` : `${netBeds} spare`}
          </span>
        )}
        <span className="text-muted-foreground">
          next {data.stats.windowHours}h · {data.stats.predictedDischarges24h}{' '}
          likely discharges
          {expectedAdmissions !== null
            ? ` · ${expectedAdmissions} expected admissions`
            : ''}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <ProvenanceBadge
            provenance={data.provenance}
            grounded={isModelGenerated(data.provenance)}
            groundedLabel="AI-narrated"
          />
          <button
            type="button"
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Details'}
          </button>
          <button
            type="button"
            className="text-muted-foreground text-xs underline-offset-2 hover:underline"
            onClick={generate}
          >
            Regenerate
          </button>
        </div>
      </div>
      {data.demandUnavailableReason && (
        <p className="text-muted-foreground mt-2 text-xs">
          {data.demandUnavailableReason} No expected-admissions or net-bed
          figure is shown rather than an assumed one.
        </p>
      )}
      <p
        className={`mt-2 text-sm leading-relaxed ${
          isModelGenerated(data.provenance)
            ? ''
            : 'border-muted-foreground/40 border-l-2 border-dashed pl-2'
        }`}
      >
        {data.briefing}
      </p>
      {open && (
        <div className="mt-3 space-y-1 border-t pt-3 text-xs">
          <p className="text-muted-foreground font-medium">
            Likely to discharge:
          </p>
          {data.predictedDischarges
            .filter((d) => d.p >= 0.5)
            .map((d) => (
              <div key={d.label} className="flex gap-2">
                <span className="font-mono">{d.label}</span>
                <span>{d.patientName}</span>
                <span className="text-muted-foreground">
                  {Math.round(d.p * 100)}% · ~{d.predictedDays}d
                </span>
              </div>
            ))}
          <p className="text-muted-foreground mt-2 text-[11px]">
            {isModelGenerated(data.provenance)
              ? 'Figures come from the deterministic forecasts; the summary is AI-narrated from them.'
              : `Figures come from the deterministic forecasts. ${PROVENANCE_COPY[data.provenance].detail}`}
          </p>
        </div>
      )}
    </div>
  )
}
