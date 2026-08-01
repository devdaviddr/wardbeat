'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmbeddingDriftNotice } from '@/components/ward/embedding-drift-notice'
import { PolicyDialog } from '@/components/ward/policy-dialog'
import { ProvenanceBadge } from '@/components/ward/provenance-badge'
import { isModelGenerated } from '@/lib/ai/provenance'
import { askCopilotAction, type CopilotResponse } from '@/lib/copilot/actions'

interface Turn {
  role: 'user' | 'assistant'
  text: string
  res?: CopilotResponse
}

const SUGGESTIONS = [
  'Which patients are fit but waiting on transport?',
  'How many beds are free?',
  'What are the criteria for discharging a patient on IV antibiotics?',
  'How quickly should pharmacy dispense TTOs?',
]

const PATH_LABEL: Record<string, string> = {
  ward_state: 'Ward state',
  policy: 'Policy',
  out_of_scope: 'Out of scope',
  error: 'Error',
}

export function CopilotChat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [pending, startTransition] = useTransition()
  const scrollRef = useRef<HTMLDivElement>(null)

  function ask(question: string) {
    const q = question.trim()
    if (!q || pending) return
    setInput('')
    setTurns((t) => [...t, { role: 'user', text: q }])
    startTransition(async () => {
      const res = await askCopilotAction(q)
      setTurns((t) => [
        ...t,
        {
          role: 'assistant',
          text: res.ok ? res.answer : (res.error ?? 'Something went wrong.'),
          res,
        },
      ])
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      )
    })
  }

  return (
    <div className="flex h-[calc(100dvh-9rem)] flex-col">
      <div>
        <h1 className="text-2xl font-semibold">Flow copilot</h1>
        <p className="text-muted-foreground text-sm">
          Ask about live ward state or discharge policy. Answers are grounded
          and cited.
        </p>
      </div>

      <div
        ref={scrollRef}
        className="mt-4 flex-1 space-y-4 overflow-y-auto rounded-lg border p-4"
      >
        {turns.length === 0 && (
          <div className="text-muted-foreground space-y-3 text-sm">
            <p>Try:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => ask(s)}>
                  <Badge
                    variant="outline"
                    className="hover:bg-muted cursor-pointer font-normal"
                  >
                    {s}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="bg-primary text-primary-foreground max-w-[80%] rounded-lg px-3 py-2 text-sm">
                {turn.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col items-start gap-2">
              {turn.res?.embeddingDrift ? (
                // The retrieval underneath any answer here was meaningless, so
                // there is no answer to show — only the reason (v0.11.0 FR8).
                <div className="max-w-[85%]">
                  <EmbeddingDriftNotice message={turn.res.embeddingDrift} />
                </div>
              ) : (
                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    turn.res && !isModelGenerated(turn.res.provenance)
                      ? 'bg-muted/60 border border-dashed'
                      : 'bg-muted/60'
                  }`}
                >
                  {turn.res?.path && turn.res.path !== 'error' && (
                    <div className="mb-1.5 flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {PATH_LABEL[turn.res.path]}
                      </Badge>
                      {turn.res.path !== 'out_of_scope' && (
                        <ProvenanceBadge
                          provenance={turn.res.provenance}
                          grounded={turn.res.grounded}
                        />
                      )}
                    </div>
                  )}
                  <p className="leading-relaxed">{turn.text}</p>
                </div>
              )}
              {turn.res?.citations && turn.res.citations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {turn.res.citations.map((c, j) =>
                    c.kind === 'ward' && c.href ? (
                      <Link key={j} href={c.href}>
                        <Badge
                          variant="outline"
                          className="cursor-pointer border-teal-500 text-teal-700 dark:text-teal-300"
                        >
                          {c.label}
                        </Badge>
                      </Link>
                    ) : c.kind === 'policy' ? (
                      <PolicyDialog
                        key={j}
                        citation={{ text: c.detail, source: c.label }}
                      >
                        <button type="button">
                          <Badge
                            variant="outline"
                            className="hover:bg-muted cursor-pointer"
                          >
                            {c.label}
                          </Badge>
                        </button>
                      </PolicyDialog>
                    ) : (
                      <Badge key={j} variant="outline">
                        {c.label}
                      </Badge>
                    ),
                  )}
                </div>
              )}
            </div>
          ),
        )}

        {pending && (
          <div className="text-muted-foreground text-sm">Thinking…</div>
        )}
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          ask(input)
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the ward or discharge policy…"
          disabled={pending}
        />
        <Button type="submit" disabled={pending || !input.trim()}>
          Ask
        </Button>
      </form>
    </div>
  )
}
