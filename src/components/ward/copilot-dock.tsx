'use client'

import { useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { askCopilotAction, type CopilotResponse } from '@/lib/copilot/actions'
import { PolicyDialog } from './policy-dialog'

const SUGGESTIONS = [
  'Which patients are fit but waiting on transport?',
  'How many beds are free?',
  'What are the criteria for discharging on IV antibiotics?',
]

const PATH_LABEL: Record<string, string> = {
  ward_state: 'Ward state',
  policy: 'Policy',
  out_of_scope: 'Out of scope',
  error: 'Error',
}

/**
 * Copilot docked onto the board. Ward-state answers call `onHighlight` with the
 * referenced bed labels so the grid emphasises them.
 */
export function CopilotDock({
  open,
  onClose,
  onHighlight,
}: {
  open: boolean
  onClose: () => void
  onHighlight: (bedLabels: string[]) => void
}) {
  const [input, setInput] = useState('')
  const [res, setRes] = useState<CopilotResponse | null>(null)
  const [pending, startTransition] = useTransition()

  if (!open) return null

  function ask(q: string) {
    const question = q.trim()
    if (!question || pending) return
    setInput('')
    startTransition(async () => {
      const r = await askCopilotAction(question)
      setRes(r)
      if (r.ok && r.path === 'ward_state') {
        onHighlight(r.citations.map((c) => c.label.replace(/^Bed\s+/, '')))
      } else {
        onHighlight([])
      }
    })
  }

  return (
    <aside className="bg-background fixed right-4 bottom-4 z-40 flex max-h-[70vh] w-[92vw] max-w-sm flex-col rounded-xl border shadow-xl">
      <header className="flex items-center justify-between border-b p-3">
        <span className="text-sm font-semibold">Flow copilot</span>
        <button
          type="button"
          onClick={() => {
            onHighlight([])
            onClose()
          }}
          className="text-muted-foreground hover:text-foreground text-sm"
          aria-label="Close copilot"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
        {!res && (
          <div className="text-muted-foreground space-y-2">
            <p>Ask about the ward or discharge policy:</p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="hover:bg-muted rounded border px-2 py-1 text-left text-xs"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {pending && <p className="text-muted-foreground">Thinking…</p>}
        {res && !pending && (
          <div className="space-y-2">
            {res.path !== 'error' && (
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {PATH_LABEL[res.path]}
                </Badge>
                {res.path !== 'out_of_scope' && (
                  <span
                    className={`text-[10px] ${res.grounded ? 'text-green-600' : 'text-amber-600'}`}
                  >
                    {res.grounded ? '● grounded' : '○ no support'}
                  </span>
                )}
              </div>
            )}
            <p className="leading-relaxed">
              {res.ok ? res.answer : (res.error ?? 'Something went wrong.')}
            </p>
            {res.citations.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {res.citations.map((c, i) =>
                  c.kind === 'policy' ? (
                    <PolicyDialog
                      key={i}
                      citation={{ text: c.detail, source: c.label }}
                    >
                      <button type="button">
                        <Badge
                          variant="outline"
                          className="hover:bg-muted cursor-pointer text-[10px]"
                        >
                          {c.label}
                        </Badge>
                      </button>
                    </PolicyDialog>
                  ) : (
                    <Badge key={i} variant="outline" className="text-[10px]">
                      {c.label}
                    </Badge>
                  ),
                )}
              </div>
            )}
            {res.path === 'ward_state' && res.citations.length > 0 && (
              <p className="text-muted-foreground text-[11px]">
                Highlighted on the board →
              </p>
            )}
          </div>
        )}
      </div>

      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask…"
          disabled={pending}
          className="h-8"
        />
        <Button type="submit" size="sm" disabled={pending || !input.trim()}>
          Ask
        </Button>
      </form>
    </aside>
  )
}
