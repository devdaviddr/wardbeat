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
import {
  approveRecommendationAction,
  dismissRecommendationAction,
} from '@/lib/actions/decide'
import { generateRecommendationsAction } from '@/lib/actions/generate'
import type { PolicyCite, QueueBed } from '@/lib/actions/queries'

const ACTION_LABEL: Record<string, string> = {
  chase_tto: 'Chase TTOs',
  book_transport: 'Book transport',
  arrange_social_care: 'Arrange social care',
  escalate_review: 'Escalate review',
  other: 'Action',
}

export function ActionQueue({ queue }: { queue: QueueBed[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<string | null>(null)
  const [cites, setCites] = useState<PolicyCite[] | null>(null)

  const total = queue.reduce((n, b) => n + b.recommendations.length, 0)

  function run(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    msg: string,
  ) {
    setStatus(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setStatus(res.error ?? 'Something went wrong.')
      else if (msg) setStatus(msg)
      router.refresh()
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Action queue</h1>
          <p className="text-muted-foreground text-sm">
            {total} recommended action{total === 1 ? '' : 's'} awaiting your
            approval. Nothing happens until you approve.
          </p>
        </div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            run(generateRecommendationsAction, 'Recommendations regenerated.')
          }
        >
          {pending ? 'Working…' : 'Generate recommendations'}
        </Button>
      </div>

      {status && (
        <p className="text-sm" role="status">
          {status}
        </p>
      )}

      {total === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          No actions to review. Make sure the board has been analysed (Run
          extraction), then click{' '}
          <span className="font-medium">Generate recommendations</span>.
        </p>
      ) : (
        queue.map((bed) => (
          <section key={bed.bedLabel} className="space-y-2">
            <h2 className="text-sm font-semibold">
              <span className="font-mono">{bed.bedLabel}</span>
              {bed.patientName ? ` · ${bed.patientName}` : ''}
            </h2>
            <div className="space-y-2">
              {bed.recommendations.map((r) => (
                <div key={r.id} className="bg-card rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {ACTION_LABEL[r.actionType] ?? 'Action'}
                    </Badge>
                    {r.priority === 1 && (
                      <Badge variant="destructive" className="text-[10px]">
                        Priority
                      </Badge>
                    )}
                    <span
                      className={`text-[10px] ${r.grounded ? 'text-green-600' : 'text-amber-600'}`}
                    >
                      {r.grounded ? '● policy-grounded' : '○ no policy support'}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium">{r.title}</p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    {r.rationale}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => approveRecommendationAction(r.id),
                          'Approved — barrier marked in progress.',
                        )
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => dismissRecommendationAction(r.id),
                          'Dismissed.',
                        )
                      }
                    >
                      Dismiss
                    </Button>
                    {r.citations.length > 0 && (
                      <button
                        type="button"
                        className="text-muted-foreground ml-auto text-xs underline-offset-2 hover:underline"
                        onClick={() => setCites(r.citations)}
                      >
                        Why? ({r.citations.length} policy)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      <Dialog open={cites !== null} onOpenChange={(o) => !o && setCites(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Policy grounding</DialogTitle>
            <DialogDescription>
              The recommendation is justified by these discharge-policy
              passages.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {cites?.map((c, i) => (
              <blockquote
                key={i}
                className="border-primary bg-muted/40 rounded border-l-2 p-3 text-sm leading-relaxed"
              >
                {c.text}
                <footer className="text-muted-foreground mt-1 text-xs">
                  — {c.source}
                </footer>
              </blockquote>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
