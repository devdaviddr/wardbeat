'use client'

import { useEffect, useState } from 'react'

import { getBriefingSummaryAction } from '@/lib/briefing/actions'
import type { FlowBriefing } from '@/lib/briefing/briefing'

/**
 * The flow briefing, loaded async so it never blocks the grid. Shows the net
 * bed position + the AI-narrated one-liner, expandable to the detail.
 */
export function BriefingStrip() {
  const [data, setData] = useState<FlowBriefing | null>(null)
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    getBriefingSummaryAction()
      .then((d) => {
        if (!alive) return
        if (d) {
          setData(d)
          setState('done')
        } else {
          setState('error')
        }
      })
      .catch(() => alive && setState('error'))
    return () => {
      alive = false
    }
  }, [])

  if (state === 'error') return null

  if (state === 'loading' || !data) {
    return (
      <div className="bg-muted/40 text-muted-foreground animate-pulse rounded-lg border p-3 text-sm">
        Generating flow briefing…
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
          className={`font-mono font-bold ${short ? 'text-amber-600' : 'text-green-600'}`}
        >
          Net {netLabel}
        </span>
        <span className="text-muted-foreground">
          next {data.stats.windowHours}h · {data.stats.predictedDischarges24h}{' '}
          likely discharges · {data.stats.expectedAdmissions} expected
          admissions
        </span>
        <button
          type="button"
          className="text-muted-foreground ml-auto text-xs underline-offset-2 hover:underline"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide' : 'Details'}
        </button>
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
