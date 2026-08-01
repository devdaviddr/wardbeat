import {
  PROVENANCE_COPY,
  isModelGenerated,
  type Provenance,
} from '@/lib/ai/provenance'

/**
 * Says what produced an AI output. The rule it enforces: only a `live` answer
 * may show the green grounded badge — a mock or fallback answer is marked as
 * not model-generated, because before this the two were indistinguishable.
 *
 * `provenance` is optional so surfaces that cannot yet report it (stored
 * recommendations) degrade to the grounded/ungrounded pair rather than claiming
 * something untrue.
 */
export function ProvenanceBadge({
  provenance,
  grounded,
  groundedLabel = 'grounded',
  ungroundedLabel = 'no support',
}: {
  provenance?: Provenance
  grounded: boolean
  groundedLabel?: string
  ungroundedLabel?: string
}) {
  if (provenance && !isModelGenerated(provenance)) {
    const copy = PROVENANCE_COPY[provenance]
    const isFallback = provenance === 'fallback'
    return (
      <span
        title={copy.detail}
        data-provenance={provenance}
        className={`text-[10px] font-medium ${
          isFallback
            ? 'text-red-700 dark:text-red-400'
            : 'text-muted-foreground'
        }`}
      >
        {isFallback ? '▲' : '◆'} {copy.label}
      </span>
    )
  }

  return (
    <span
      title={
        grounded
          ? PROVENANCE_COPY.live.detail
          : 'No source supports this answer.'
      }
      data-provenance={provenance ?? 'unknown'}
      className={`text-[10px] ${
        grounded
          ? 'text-green-700 dark:text-green-400'
          : 'text-amber-700 dark:text-amber-400'
      }`}
    >
      {grounded ? `● ${groundedLabel}` : `○ ${ungroundedLabel}`}
    </span>
  )
}
