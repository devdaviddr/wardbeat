import { Badge } from '@/components/ui/badge'
import type { FlowBriefing as FlowBriefingData } from '@/lib/briefing/briefing'

const pct = (p: number) => `${Math.round(p * 100)}%`

export function FlowBriefing({ data }: { data: FlowBriefingData }) {
  const { stats } = data
  // Both figures depend on the demand projection, and the projection is absent
  // whenever the ward's admission history is too thin to support one. An
  // absent number is recoverable; a fabricated one costs the tool its
  // credibility on the first bed move made against it (spec v0.11.0 FR3).
  const short = stats.netBeds !== null && stats.netBeds < 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Flow briefing</h1>
        <p className="text-muted-foreground text-sm">
          {data.wardName} · next {stats.windowHours}h · forecasts are
          model-generated, the summary is AI-narrated from them.
        </p>
      </div>

      {/* Net position */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.netBeds === null ? (
          <Unavailable label="net bed position" />
        ) : (
          <div
            className={`rounded-lg border p-3 ${short ? 'border-amber-400' : 'border-green-400'}`}
          >
            <div
              className={`font-mono text-2xl font-bold ${short ? 'text-amber-700 dark:text-amber-400' : 'text-green-700 dark:text-green-400'}`}
            >
              {short
                ? `${Math.abs(stats.netBeds)} short`
                : `${stats.netBeds} spare`}
            </div>
            <div className="text-muted-foreground text-xs">
              net bed position
            </div>
          </div>
        )}
        <Stat n={stats.predictedDischarges24h} label="likely discharges" />
        {stats.expectedAdmissions === null ? (
          <Unavailable label="expected admissions" />
        ) : (
          <Stat n={stats.expectedAdmissions} label="expected admissions" />
        )}
        <Stat n={stats.free} label="free now" />
      </div>

      {data.demandUnavailableReason && (
        <p className="text-muted-foreground border-l-2 border-dashed pl-3 text-sm">
          <span className="font-medium">
            No demand projection for this ward.
          </span>{' '}
          {data.demandUnavailableReason} WardBeat shows nothing rather than an
          assumed admission rate — the figure would look identical whether or
          not it meant anything.
        </p>
      )}

      {stats.expectedAdmissions !== null && data.admissionsLast7d !== null && (
        <p className="text-muted-foreground text-xs">
          Demand projected from {data.admissionsLast7d} admissions recorded on
          this ward in the last 7 days, pro-rated over {stats.windowHours}h. It
          assumes the coming window looks like the trailing week; it does not
          know about planned lists, seasonality or the time of day.
        </p>
      )}

      {/* AI-narrated briefing */}
      <div className="bg-muted/50 rounded-lg border p-4">
        <p className="text-sm leading-relaxed">{data.briefing}</p>
        <p className="text-muted-foreground mt-2 text-[11px]">
          AI-narrated from the figures above — no numbers are model-invented.
        </p>
      </div>

      {/* Predicted discharges */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Predicted discharges (24h)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 pr-4 font-medium">Bed</th>
                <th className="py-1 pr-4 font-medium">Patient</th>
                <th className="py-1 pr-4 font-medium">P(discharge 24h)</th>
                <th className="py-1 font-medium">Predicted stay</th>
              </tr>
            </thead>
            <tbody className="font-variant-numeric tabular-nums">
              {data.predictedDischarges.map((d) => (
                <tr key={d.label} className="border-t">
                  <td className="py-1 pr-4 font-mono">{d.label}</td>
                  <td className="py-1 pr-4">{d.patientName ?? '—'}</td>
                  <td className="py-1 pr-4">
                    <span
                      className={
                        d.p >= 0.5
                          ? 'text-green-700 dark:text-green-400'
                          : 'text-muted-foreground'
                      }
                    >
                      {pct(d.p)}
                    </span>
                  </td>
                  <td className="py-1">{d.predictedDays}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* At-risk / gated */}
      {data.atRisk.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Fit but gated on a barrier</h2>
          <div className="flex flex-wrap gap-1.5">
            {data.atRisk.map((r) => (
              <Badge
                key={r.label}
                variant="outline"
                className="border-amber-400 text-amber-700 dark:text-amber-300"
              >
                {r.label}: {r.barriers.join(', ')}
              </Badge>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="font-mono text-2xl font-bold tabular-nums">{n}</div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}

/**
 * The same tile shape as `Stat`, with an em dash where the number would be.
 * Deliberately keeps the slot rather than collapsing it: a missing tile reads
 * as a layout change, an empty one reads as a fact about the ward.
 */
function Unavailable({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed bg-transparent p-3">
      <div
        className="text-muted-foreground font-mono text-2xl font-bold"
        aria-label={`${label} unavailable`}
      >
        —
      </div>
      <div className="text-muted-foreground text-xs">{label}</div>
    </div>
  )
}
