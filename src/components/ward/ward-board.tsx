'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { runWardExtractionAction } from '@/lib/ward/actions'
import type { BoardBarrier, BoardBed, WardBoard } from '@/lib/ward/queries'

const BARRIER_LABELS: Record<BoardBarrier['type'], string> = {
  tto: 'TTO / meds',
  transport: 'Transport',
  social_care: 'Social care',
  review: 'Review',
  other: 'Other',
}

function highlight(text: string, quote: string) {
  if (!quote) return text
  const idx = text.toLowerCase().indexOf(quote.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-700/60">
        {text.slice(idx, idx + quote.length)}
      </mark>
      {text.slice(idx + quote.length)}
    </>
  )
}

export function WardBoardView({ board }: { board: WardBoard }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)
  const [mffdOnly, setMffdOnly] = useState(false)
  const [citation, setCitation] = useState<BoardBarrier | null>(null)

  const beds = mffdOnly
    ? board.beds.filter((b) => b.mffd && b.barriers.length > 0)
    : board.beds

  function runExtraction() {
    setStatus(null)
    startTransition(async () => {
      const res = await runWardExtractionAction()
      setStatus(
        res.ok
          ? `Extracted ${res.processed} notes → ${res.barriers} barriers` +
              (res.ungrounded ? ` (${res.ungrounded} ungrounded dropped)` : '')
          : `Failed: ${res.error ?? 'unknown error'}`,
      )
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{board.wardName}</h1>
          <p className="text-muted-foreground text-sm">
            {board.stats.occupied} occupied · {board.stats.free} free ·{' '}
            <span className="font-medium text-amber-600 dark:text-amber-400">
              {board.stats.mffdDelayed} fit-but-delayed
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={mffdOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMffdOnly((v) => !v)}
          >
            {mffdOnly ? 'Showing fit-but-delayed' : 'Show fit-but-delayed'}
          </Button>
          <Button size="sm" onClick={runExtraction} disabled={pending}>
            {pending ? 'Extracting…' : 'Run extraction'}
          </Button>
        </div>
      </div>

      {board.stats.unprocessed > 0 && (
        <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
          {board.stats.unprocessed} occupied bed(s) not yet analysed — click{' '}
          <span className="font-medium">Run extraction</span> to read the notes.
        </p>
      )}
      {status && (
        <p className="text-sm" role="status">
          {status}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {beds.map((bed) => (
          <BedCard key={bed.id} bed={bed} onCite={setCitation} />
        ))}
      </div>

      <Dialog
        open={citation !== null}
        onOpenChange={(o) => !o && setCitation(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {citation ? BARRIER_LABELS[citation.type] : ''} — source
            </DialogTitle>
            <DialogDescription>
              Extracted from the {citation?.authorRole} note. The cited span is
              highlighted.
            </DialogDescription>
          </DialogHeader>
          {citation && (
            <blockquote className="border-primary bg-muted/40 rounded border-l-2 p-3 text-sm leading-relaxed">
              {highlight(citation.noteText, citation.quote)}
            </blockquote>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BedCard({
  bed,
  onCite,
}: {
  bed: BoardBed
  onCite: (b: BoardBarrier) => void
}) {
  const empty = !bed.occupied
  return (
    <div
      className={`rounded-lg border p-3 ${
        empty ? 'border-dashed opacity-70' : 'bg-card'
      }`}
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

          {bed.barriers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {bed.barriers.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onCite(b)}
                  title="View source note"
                >
                  <Badge
                    variant="outline"
                    className="cursor-pointer border-amber-400 text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950"
                  >
                    {BARRIER_LABELS[b.type]}
                  </Badge>
                </button>
              ))}
            </div>
          ) : bed.extracted ? (
            <p className="text-muted-foreground text-xs">No open barriers</p>
          ) : (
            <p className="text-muted-foreground text-xs italic">Not analysed</p>
          )}
        </div>
      )}
    </div>
  )
}
