'use client'

import { useState, useTransition } from 'react'
import { FileText } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  approveRecommendationAction,
  dismissRecommendationAction,
} from '@/lib/actions/decide'
import type { CockpitRecommendation } from '@/lib/ward/cockpit'
import { PolicyDialog } from './policy-dialog'

const ACTION_LABELS: Record<string, string> = {
  chase_tto: 'Chase TTOs',
  book_transport: 'Book transport',
  arrange_social_care: 'Arrange social care',
  escalate_review: 'Escalate review',
  other: 'Action',
}

/**
 * One recommended action with inline Approve/Dismiss. Self-contained (manages
 * its own pending state); calls `onChanged` after a decision so the caller can
 * refresh. Shared by the bed drawer and the board's actions panel.
 */
export function RecommendationCard({
  rec,
  onChanged,
}: {
  rec: CockpitRecommendation
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)

  function decide(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    ok: string,
  ) {
    setMsg(null)
    startTransition(async () => {
      const r = await fn()
      setMsg(r.ok ? ok : (r.error ?? 'Something went wrong.'))
      onChanged()
    })
  }

  return (
    <div className="bg-card rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">
          {ACTION_LABELS[rec.actionType] ?? 'Action'}
        </Badge>
        {rec.priority === 1 && (
          <Badge variant="destructive" className="text-[10px]">
            Priority
          </Badge>
        )}
        <span
          className={`text-[10px] ${rec.grounded ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}
        >
          {rec.grounded ? '● policy-grounded' : '○ no policy'}
        </span>
      </div>
      <p className="mt-1 text-sm font-medium">{rec.title}</p>
      <p className="text-muted-foreground mt-0.5 text-sm">{rec.rationale}</p>
      {rec.citations.length > 0 && (
        <details className="mt-1 text-xs">
          <summary className="text-muted-foreground cursor-pointer">
            Why? ({rec.citations.length} policy)
          </summary>
          {rec.citations.map((c, i) => (
            <blockquote
              key={i}
              className="border-primary bg-muted/40 mt-1 rounded border-l-2 p-2 leading-relaxed"
            >
              {c.text}{' '}
              <PolicyDialog citation={{ text: c.text, source: c.source }}>
                <button
                  type="button"
                  className="text-primary inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
                >
                  — {c.source}
                  <FileText className="h-3 w-3" />
                </button>
              </PolicyDialog>
            </blockquote>
          ))}
        </details>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            decide(
              () => approveRecommendationAction(rec.id),
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
            decide(() => dismissRecommendationAction(rec.id), 'Dismissed.')
          }
        >
          Dismiss
        </Button>
        {msg && (
          <span className="text-muted-foreground text-xs" role="status">
            {msg}
          </span>
        )}
      </div>
    </div>
  )
}
