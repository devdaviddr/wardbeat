import { AlertTriangle } from 'lucide-react'

/**
 * Says out loud that policy search is comparing two unrelated vector spaces
 * (spec v0.11.0 FR8).
 *
 * This is the one failure in the copilot that produces no error of its own: a
 * knowledge base seeded with mock embeddings and queried with live ones still
 * returns a full, confidently-ranked result set, because both vectors are
 * 1024-d and cosine distance has no opinion about what they mean. Before this
 * notice the only visible symptom was a green "grounded" badge on nonsense.
 *
 * Rendered as an error, not a hint — the answer above it is withheld, and the
 * remedy (re-seed the policy KB) is stated in the message itself.
 */
export function EmbeddingDriftNotice({ message }: { message: string }) {
  return (
    <div
      role="alert"
      data-testid="embedding-drift"
      className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">
          Policy search is not trustworthy right now
        </p>
        <p className="mt-0.5 leading-relaxed">{message}</p>
      </div>
    </div>
  )
}
