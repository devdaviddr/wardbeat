'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { EddSource } from '@/db/schema'
import { setEncounterEddAction } from '@/lib/ward/edd'

/**
 * The estimated discharge date, with the authorship made visible.
 *
 * Whether the date came from the notes or from a person is the whole point: a
 * clinician-set date outranks the model's and survives the next extraction, so
 * the board has to say which it is showing.
 */
export function EddEditor({
  encounterId,
  edd,
  source,
  setByName,
  canEdit,
  onChanged,
}: {
  encounterId: string
  edd: string | null
  source: EddSource
  setByName: string | null
  /** Hides the Set/Change controls; `setEncounterEddAction` re-checks. */
  canEdit: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(edd ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const save = (next: string | null) => {
    setError(null)
    startTransition(async () => {
      const res = await setEncounterEddAction(encounterId, next)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEditing(false)
      onChanged()
    })
  }

  return (
    <section>
      <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
        Estimated discharge
      </h3>

      {!editing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono">{edd ?? 'Not set'}</span>
          {edd &&
            (source === 'human' ? (
              <Badge variant="secondary" title={setByName ?? undefined}>
                Set by {setByName ?? 'a clinician'}
              </Badge>
            ) : (
              <Badge variant="outline">From the notes</Badge>
            ))}
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => {
                setValue(edd ?? '')
                setEditing(true)
              }}
            >
              {edd ? 'Change' : 'Set'}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-8 w-40 text-xs"
            disabled={pending}
          />
          <Button
            size="sm"
            disabled={pending || !value}
            onClick={() => save(value)}
          >
            Save
          </Button>
          {source === 'human' && (
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => save(null)}
              title="Hand this field back to extraction"
            >
              Use the notes
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-1 text-xs">
          {error}
        </p>
      )}
    </section>
  )
}
