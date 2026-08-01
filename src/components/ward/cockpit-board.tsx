'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { runWardExtractionAction } from '@/lib/ward/actions'
import type { Cockpit, CockpitBed } from '@/lib/ward/cockpit'

import { ActionsDrawer } from './actions-drawer'
import { BedDrawer } from './bed-drawer'
import { BriefingStrip } from './briefing-strip'
import { CopilotDock } from './copilot-dock'

export function CockpitBoard({ cockpit }: { cockpit: Cockpit }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)
  const [mffdOnly, setMffdOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dockOpen, setDockOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set())

  const totalActions = cockpit.beds.reduce((n, b) => n + b.actionCount, 0)

  // Derived: if the selected bed disappears after a refresh, this becomes null
  // and the drawer closes on its own — no effect needed.
  const selected = selectedId
    ? (cockpit.beds.find((b) => b.id === selectedId) ?? null)
    : null

  const beds = mffdOnly
    ? cockpit.beds.filter((b) => b.mffd && b.barriers.length > 0)
    : cockpit.beds

  function runExtraction() {
    setStatus(null)
    startTransition(async () => {
      const res = await runWardExtractionAction()
      setStatus(
        res.ok
          ? `Extracted ${res.processed} notes → ${res.barriers} barriers` +
              (res.failed > 0 ? ` (${res.failed} failed)` : '')
          : `Failed: ${res.error ?? 'unknown error'}`,
      )
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{cockpit.wardName}</h1>
          <p className="text-muted-foreground text-sm">
            {cockpit.stats.occupied} occupied · {cockpit.stats.free} free ·{' '}
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {cockpit.stats.mffdDelayed} fit-but-delayed
            </span>
            {cockpit.stats.overdue > 0 && (
              <>
                {' '}
                ·{' '}
                <span className="text-destructive font-medium">
                  {cockpit.stats.overdue} overdue
                </span>
              </>
            )}
          </p>
          {/* How current is this? The board is only as fresh as the last run. */}
          <p className="text-muted-foreground text-xs">
            {cockpit.lastExtractedAt
              ? `Notes last read ${new Date(cockpit.lastExtractedAt).toLocaleString()}`
              : 'Notes not yet read — run extraction'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {highlighted.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHighlighted(new Set())}
            >
              Clear highlight
            </Button>
          )}
          <Button
            variant={mffdOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMffdOnly((v) => !v)}
          >
            {mffdOnly ? 'Showing fit-but-delayed' : 'Show fit-but-delayed'}
          </Button>
          <Button
            variant={actionsOpen ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActionsOpen((v) => !v)}
          >
            Actions{totalActions > 0 ? ` (${totalActions})` : ''}
          </Button>
          <Button
            variant={dockOpen ? 'default' : 'outline'}
            size="sm"
            onClick={() => setDockOpen((v) => !v)}
          >
            Ask copilot
          </Button>
          <Button size="sm" onClick={runExtraction} disabled={pending}>
            {pending ? 'Extracting…' : 'Run extraction'}
          </Button>
        </div>
      </div>

      <BriefingStrip />

      {status && (
        <p className="text-sm" role="status">
          {status}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {beds.map((bed) => (
          <BedCard
            key={bed.id}
            bed={bed}
            emphasised={highlighted?.has(bed.label) ?? false}
            onOpen={() => setSelectedId(bed.id)}
          />
        ))}
      </div>

      <BedDrawer
        key={selectedId ?? 'none'}
        bed={selected}
        people={cockpit.people}
        onClose={() => setSelectedId(null)}
        onChanged={() => router.refresh()}
      />

      <ActionsDrawer
        cockpit={cockpit}
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onChanged={() => router.refresh()}
      />

      <CopilotDock
        open={dockOpen}
        onClose={() => setDockOpen(false)}
        onHighlight={(labels) => setHighlighted(new Set(labels))}
      />
    </div>
  )
}

function BedCard({
  bed,
  emphasised,
  onOpen,
}: {
  bed: CockpitBed
  emphasised: boolean
  onOpen: () => void
}) {
  const empty = !bed.occupied
  const pct =
    bed.pDischarge != null ? `${Math.round(bed.pDischarge * 100)}%` : null
  const oldestBarrierDays = bed.barriers.reduce(
    (max, b) => Math.max(max, b.ageDays),
    0,
  )
  const overdueCount = bed.barriers.filter((b) => b.overdue).length
  const ownedCount = bed.barriers.filter((b) => b.ownerUserId).length

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`rounded-lg border p-3 text-left transition-colors ${
        empty ? 'border-dashed opacity-70' : 'bg-card hover:border-primary'
      } ${emphasised ? 'ring-primary ring-2' : ''}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">{bed.label}</span>
        {empty ? (
          <Badge variant="outline">Free</Badge>
        ) : bed.mffd ? (
          <Badge variant="success">MFFD</Badge>
        ) : (
          <Badge variant="secondary">Inpatient</Badge>
        )}
      </div>

      {!empty && (
        <div className="mt-2 space-y-2">
          <div>
            <p className="text-sm font-medium">{bed.patientName}</p>
            <p className="text-muted-foreground text-xs">
              {bed.mrn}
              {bed.edd ? ` · EDD ${bed.edd}` : ''}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {bed.barriers.length > 0 ? (
              <>
                <Badge
                  variant="outline"
                  className="border-amber-400 text-amber-700 dark:text-amber-300"
                >
                  {bed.barriers.length} barrier
                  {bed.barriers.length === 1 ? '' : 's'}
                </Badge>
                {/* Oldest open barrier — how long this bed has been stuck is
                    the signal a flow coordinator actually escalates on. */}
                {oldestBarrierDays > 0 && (
                  <Badge variant="outline" title="Oldest open barrier">
                    {oldestBarrierDays}d
                  </Badge>
                )}
                {overdueCount > 0 && (
                  <Badge variant="destructive">{overdueCount} overdue</Badge>
                )}
                {ownedCount > 0 && (
                  <Badge variant="secondary" title="Barriers with an owner">
                    {ownedCount} owned
                  </Badge>
                )}
              </>
            ) : bed.extracted ? (
              <span className="text-muted-foreground text-xs">No barriers</span>
            ) : (
              <span className="text-muted-foreground text-xs italic">
                Not analysed
              </span>
            )}
            {bed.actionCount > 0 && (
              <Badge variant="default" className="gap-0.5">
                ⚡{bed.actionCount}
              </Badge>
            )}
            {pct && (
              <span
                className={`ml-auto font-mono text-xs tabular-nums ${
                  bed.pDischarge! >= 0.5
                    ? 'text-green-600'
                    : 'text-muted-foreground'
                }`}
                title="P(discharge in 24h)"
              >
                {pct}
              </span>
            )}
          </div>
        </div>
      )}
    </button>
  )
}
