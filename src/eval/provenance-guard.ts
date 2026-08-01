import type { Provenance } from '@/lib/ai/provenance'

/**
 * Makes the eval gates capable of failing (spec v0.11.0 FR7).
 *
 * Every harness passed with `NIM_MOCK=true`, so an expired API key would have
 * left all four green — a passing run did not prove the models were involved
 * at all. The scores were real; what they measured was not necessarily a model.
 *
 * Each harness now records the provenance of every AI response it consumes and
 * calls `assertLive()` before reporting. Without `--allow-mock` on the command
 * line, a run that touched the mock or a fallback exits non-zero and says so.
 *
 * `--allow-mock` is deliberately a **CLI flag, not an env var**: an env var can
 * be set once in a shell profile or a compose file and silently disable the
 * guard everywhere, which is precisely the failure mode this exists to stop.
 */

const ALLOW_MOCK_FLAG = '--allow-mock'

/** True when the operator explicitly accepted a non-live run. */
export function allowMock(argv: string[] = process.argv): boolean {
  return argv.includes(ALLOW_MOCK_FLAG)
}

interface Seen {
  provenance: Provenance
  /** Which call produced it, so a failure names the route, not just a count. */
  label: string
}

const seen: Seen[] = []

/**
 * Record one AI response's provenance. Pass the raw parsed body; anything
 * without a `provenance` field is treated as **unknown and non-live**, because
 * a service that stopped reporting provenance is exactly as untrustworthy as
 * one that answered from the mock.
 */
export function recordProvenance(label: string, body: unknown): void {
  const value = (body as { provenance?: unknown } | null)?.provenance
  const provenance: Provenance =
    value === 'live' || value === 'mock' || value === 'fallback'
      ? value
      : 'mock'
  seen.push({ label, provenance })
}

export interface ProvenanceSummary {
  total: number
  live: number
  nonLive: Seen[]
}

export function summariseProvenance(): ProvenanceSummary {
  return {
    total: seen.length,
    live: seen.filter((s) => s.provenance === 'live').length,
    nonLive: seen.filter((s) => s.provenance !== 'live'),
  }
}

/**
 * Print what the run actually ran against, and exit non-zero if that was not a
 * live model — unless `--allow-mock` was passed.
 *
 * Call this **before** reporting scores, so a mocked run never prints a green
 * gate that someone could screenshot.
 */
export function assertLive(argv: string[] = process.argv): void {
  const { total, live, nonLive } = summariseProvenance()

  if (total === 0) {
    console.error(
      '\n✗ No AI responses were recorded — this harness proves nothing.\n' +
        '  The provenance guard is not wired into its call sites.',
    )
    process.exit(1)
  }

  if (nonLive.length === 0) {
    console.log(`\n✓ Provenance: ${live}/${total} responses from a live model.`)
    return
  }

  const breakdown = new Map<string, number>()
  for (const s of nonLive) {
    const key = `${s.label} → ${s.provenance}`
    breakdown.set(key, (breakdown.get(key) ?? 0) + 1)
  }
  const detail = [...breakdown]
    .map(([k, n]) => `    ${k} ×${n}`)
    .sort()
    .join('\n')

  if (allowMock(argv)) {
    console.warn(
      `\n⚠ Provenance: ${live}/${total} live; ${nonLive.length} from the mock or a fallback.\n` +
        `${detail}\n` +
        `  Running with ${ALLOW_MOCK_FLAG} — the scores below do NOT evidence model quality.`,
    )
    return
  }

  console.error(
    `\n✗ Provenance gate failed: ${nonLive.length}/${total} responses did not come from a live model.\n` +
      `${detail}\n\n` +
      '  A gate that passes against the mock proves nothing about the models.\n' +
      `  Set NVIDIA_API_KEY and NIM_MOCK=false, or re-run with ${ALLOW_MOCK_FLAG}\n` +
      '  if you deliberately want to exercise the offline path.',
  )
  process.exit(1)
}

/** Test seam — the module-level accumulator is per-process by design. */
export function resetProvenance(): void {
  seen.length = 0
}
