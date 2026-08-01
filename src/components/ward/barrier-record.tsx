'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Assignee } from '@/lib/ward/people'
import type { BarrierEventEntry, BoardBarrier } from '@/lib/ward/queries'
import {
  assignBarrierAction,
  clearBarrierAction,
  commentOnBarrierAction,
  dismissBarrierAction,
} from '@/lib/ward/barrier-lifecycle'

/**
 * A barrier as a working record rather than a read-only chip: who owns it, when
 * it is due, how long it has been open, what has happened to it, and the
 * controls to move it along. Clearing is the one that matters most — before
 * v0.10.0 there was no way to finish a barrier at all.
 */

const BARRIER_LABELS: Record<string, string> = {
  tto: 'TTO / meds',
  transport: 'Transport',
  social_care: 'Social care',
  review: 'Review',
  other: 'Other',
}

const EVENT_VERBS: Record<string, string> = {
  created: 'raised',
  confirmed: 're-confirmed by extraction',
  unconfirmed: 'no longer in the notes',
  assigned: 'assigned',
  unassigned: 'unassigned',
  due_set: 'due time set',
  commented: '',
  cleared: 'cleared',
  dismissed: 'dismissed',
  reopened: 'reopened',
}

function ageLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return '1 day'
  return `${days} days`
}

function EventThread({ events }: { events: BarrierEventEntry[] }) {
  if (events.length === 0) return null
  return (
    <ol className="mt-2 space-y-1 border-l pl-3">
      {events.map((e) => (
        <li key={e.id} className="text-muted-foreground text-xs">
          <span className="font-medium">{e.actorName ?? 'Extraction'}</span>{' '}
          {EVENT_VERBS[e.kind] ?? e.kind}
          {e.body ? <>: &ldquo;{e.body}&rdquo;</> : null}
          <span className="opacity-60">
            {' '}
            · {new Date(e.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function BarrierRecord({
  barrier,
  people,
  onChanged,
}: {
  barrier: BoardBarrier
  people: Assignee[]
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'none' | 'clear' | 'dismiss'>('none')

  // Every control funnels through here so a failed action always surfaces its
  // message instead of failing silently.
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) {
        setError(res.error ?? 'Something went wrong.')
        return
      }
      setComment('')
      setReason('')
      setMode('none')
      onChanged()
    })
  }

  return (
    <li className="rounded border p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-amber-400">
          {BARRIER_LABELS[barrier.type] ?? barrier.type}
        </Badge>
        {barrier.origin === 'human' && (
          <Badge variant="secondary">Added by a clinician</Badge>
        )}
        {barrier.status === 'in_progress' && (
          <Badge variant="secondary">In progress</Badge>
        )}
        {barrier.overdue && <Badge variant="destructive">Overdue</Badge>}
        {barrier.unconfirmed && (
          <Badge
            variant="outline"
            title="The latest notes no longer mention this"
          >
            Not in latest notes
          </Badge>
        )}
        <span className="text-muted-foreground ml-auto text-xs">
          open {ageLabel(barrier.ageDays)}
        </span>
      </div>

      {/* What the barrier actually says. */}
      {barrier.origin === 'human' ? (
        <p className="mb-2">{barrier.description}</p>
      ) : (
        <details className="text-muted-foreground mb-2 text-xs">
          <summary className="cursor-pointer">
            &ldquo;{barrier.quote}&rdquo;
          </summary>
          <p className="mt-1 leading-relaxed">
            From the {barrier.authorRole} note: {barrier.noteText}
          </p>
        </details>
      )}

      <p className="text-muted-foreground mb-2 text-xs">
        {barrier.ownerName ? (
          <>
            Owner: <span className="font-medium">{barrier.ownerName}</span>
          </>
        ) : (
          'Unassigned'
        )}
        {barrier.dueAt && (
          <> · due {new Date(barrier.dueAt).toLocaleString()}</>
        )}
      </p>

      {/* Assign */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`owner-${barrier.id}`}>
          Assign this barrier
        </label>
        <select
          id={`owner-${barrier.id}`}
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          defaultValue={barrier.ownerUserId ?? ''}
          disabled={pending}
          onChange={(e) => {
            const value = e.target.value
            if (value) run(() => assignBarrierAction(barrier.id, value))
          }}
        >
          <option value="">Assign to…</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Progress note */}
      <div className="mb-2 flex gap-2">
        <Input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add a progress note…"
          className="h-8 text-xs"
          disabled={pending}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !comment.trim()}
          onClick={() => run(() => commentOnBarrierAction(barrier.id, comment))}
        >
          Note
        </Button>
      </div>

      {/* Resolve */}
      {mode === 'none' ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => setMode('clear')}>
            Mark cleared
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setMode('dismiss')}
            title="The AI got this wrong"
          >
            Not a barrier
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === 'clear' ? 'How was it resolved?' : 'Why is this wrong?'
            }
            className="h-8 text-xs"
            autoFocus
            disabled={pending}
          />
          <Button
            size="sm"
            disabled={pending || !reason.trim()}
            onClick={() =>
              run(() =>
                mode === 'clear'
                  ? clearBarrierAction(barrier.id, reason)
                  : dismissBarrierAction(barrier.id, reason),
              )
            }
          >
            Confirm
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMode('none')}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}

      <EventThread events={barrier.events} />
    </li>
  )
}
