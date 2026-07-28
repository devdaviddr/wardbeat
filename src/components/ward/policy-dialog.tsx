'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { getPolicySource, type PolicyDocView } from '@/lib/ward/policy-source'
import { cn } from '@/lib/utils'

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; doc: PolicyDocView }
  | { status: 'missing' }

/**
 * Opens a policy citation as its full source document, with the cited passage
 * highlighted. `children` is the trigger. Resolution and auth happen server-side
 * (`getPolicySource`); when the document can't be resolved it degrades to a
 * passage-only view rather than erroring.
 */
export function PolicyDialog({
  citation,
  children,
}: {
  citation: { chunkId?: string; text?: string; source: string }
  children: React.ReactNode
}) {
  const [state, setState] = useState<State>({ status: 'idle' })

  async function onOpenChange(open: boolean) {
    if (open && state.status === 'idle') {
      setState({ status: 'loading' })
      const doc = await getPolicySource(citation)
      setState(doc ? { status: 'loaded', doc } : { status: 'missing' })
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 shrink-0" />
            {state.status === 'loaded' ? state.doc.source : citation.source}
          </DialogTitle>
          <DialogDescription>
            {state.status === 'loaded'
              ? state.doc.title
              : 'Referenced discharge policy'}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {state.status === 'loading' && (
            <p className="text-muted-foreground text-sm">Loading policy…</p>
          )}
          {state.status === 'missing' && (
            <blockquote className="border-primary bg-muted/40 rounded border-l-2 p-3 text-sm leading-relaxed">
              {citation.text}
              <span className="text-muted-foreground mt-2 block text-xs">
                The full document isn’t available in this instance — showing the
                cited passage.
              </span>
            </blockquote>
          )}
          {state.status === 'loaded' &&
            state.doc.chunks.map((c) => (
              <p
                key={c.ordinal}
                className={cn(
                  'rounded p-2 text-sm leading-relaxed',
                  c.cited
                    ? 'border-primary bg-primary/10 border-l-2 font-medium'
                    : 'text-muted-foreground',
                )}
              >
                {c.text}
              </p>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
