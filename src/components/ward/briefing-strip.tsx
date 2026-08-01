'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
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
  const [open, setOpen] = useState(false)

  function generate() {
    setState('loading')
    getBriefingSummaryAction()
      .then((d) => {
        if (d) {
          setData(d)
          setState('done')
        } else {
          setState('error')
        }
      })
      .catch(() => setState('error'))
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
            ? "Couldn't generate the briefing."
            : 'Flow briefing — net bed position + a narrated shift summary.'}
        </span>
        <Button size="sm" variant="outline" onClick={generate}>
          {state === 'error' ? 'Retry' : 'Generate briefing'}
        </Button>
      </div>
    )
  }

  const short = data.stats.netBeds < 0
  const netLabel = short
    ? `${Math.abs(data.stats.netBeds)} short`
    : `${data.stats.netBeds} spare`

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span
          className={`font-mono font-bold ${short ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}
        >
          Net {netLabel}
        </span>
        <span className="text-muted-foreground">
          next {data.stats.windowHours}h · {data.stats.predictedDischarges24h}{' '}
          likely discharges · {data.stats.expectedAdmissions} expected
          admissions
        </span>
        <div className="ml-auto flex items-center gap-3">
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
      <p className="mt-2 text-sm leading-relaxed">{data.briefing}</p>
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
            Figures are model-generated; the summary is AI-narrated from them.
          </p>
        </div>
      )}
    </div>
  )
}
