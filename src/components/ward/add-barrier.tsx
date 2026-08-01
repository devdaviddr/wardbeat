'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BARRIER_TYPES, type BarrierType } from '@/db/schema'
import { createBarrierAction } from '@/lib/ward/barrier-lifecycle'

/**
 * Raise a barrier the extraction missed.
 *
 * Clinicians will not trust a board they cannot correct, and until now every
 * barrier on it was model-authored and read-only. A barrier added here is
 * marked human-authored, which makes it invisible to reconcile — no model re-run
 * can remove it.
 */

const TYPE_LABELS: Record<BarrierType, string> = {
  tto: 'TTO / meds',
  transport: 'Transport',
  social_care: 'Social care',
  review: 'Review',
  other: 'Other',
}

export function AddBarrier({
  encounterId,
  onChanged,
}: {
  encounterId: string
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<BarrierType>('other')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Add barrier
      </Button>
    )
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      const res = await createBarrierAction({ encounterId, type, description })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setDescription('')
      setOpen(false)
      onChanged()
    })
  }

  return (
    <div className="bg-muted/40 w-full rounded border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`type-${encounterId}`}>
          Barrier type
        </label>
        <select
          id={`type-${encounterId}`}
          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
          value={type}
          disabled={pending}
          onChange={(e) => setType(e.target.value as BarrierType)}
        >
          {BARRIER_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What is holding this discharge up?"
          className="h-8 flex-1 text-xs"
          autoFocus
          disabled={pending}
        />
        <Button
          size="sm"
          disabled={pending || !description.trim()}
          onClick={submit}
        >
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
