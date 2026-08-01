import { config } from 'dotenv'
import { eq, isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { encounters, notes } from '../db/schema'
import { daysAdmitted } from '../lib/ward/length-of-stay'
import { statesANetPosition } from './narration-guard'
import { assertLive, recordProvenance } from './provenance-guard'

/**
 * Forecast eval (spec v0.5.0, ground truth reworked in v0.11.0 FR7).
 *
 * ## What changed and why
 *
 * This harness used to define ground truth as `mffd - 0.1 * open_barriers` —
 * two of the model's own input features, recombined with the same signs the
 * model weights them with. Spearman ρ between a monotone function of `x` and
 * another monotone function of the same `x` is near 1 by construction. The
 * reported ρ of 0.92 was not evidence of predictive accuracy; it was evidence
 * that arithmetic is consistent. Nothing short of inverting a weight's sign
 * could have made it fail, and no amount of the model being wrong about real
 * patients would have shown up.
 *
 * Ground truth is now a **hand-assigned expected discharge window** per seeded
 * encounter (`evalLabels.expectedDischargeWindow`), written by reading the note
 * prose. It is not a function of the model's features, and it disagrees with
 * the model in places the model cannot see — a stretcher ambulance versus a
 * lift home, a district-nurse referral versus a care-home placement, "not fit
 * today" versus "far from home".
 *
 * ## What this can and cannot tell you
 *
 * n = 12, hand-labelled by one person, on synthetic notes. It can detect an
 * inverted or badly mis-scaled weight and a dead input. It cannot estimate
 * real-world accuracy, and the confidence interval on ρ at this n is wide
 * enough to drive a bed through. The harness prints its own n so the score is
 * never read without it.
 *
 *   docker compose up -d db ai && pnpm db:seed:ward && pnpm eval:forecast
 */
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''

/**
 * Ground-truth gate, restated for the new target.
 *
 * The old ρ ≥ 0.7 in this file (and the ρ ≥ 0.9 the docs quoted) are
 * **retired**, not carried forward. They scored a different, circular
 * quantity; reusing either number would imply a continuity of measurement that
 * does not exist. That the new gate lands near the old one is a coincidence of
 * arithmetic, not evidence the old one was fine.
 *
 * 0.70 is set from the **shuffled-label null**: permuting the truth labels
 * against the model's own predictions 20,000 times at n=12 gives a 99th
 * percentile of ρ = 0.666. A gate of 0.70 is therefore the point above which
 * passing cannot reasonably be attributed to chance at this sample size
 * (P ≈ 0.008 for a model with no signal). Observed ρ is 0.82, and it stays
 * ≥ 0.80 for a seed up to 30 days stale, so there is ~0.10 of headroom.
 *
 * **What this gate catches** (measured, by perturbing the model):
 *   dead `days_admitted` (hardcoded back to 3) → 0.36 · fails
 *   `mffd` weight inverted                     → 0.00 · fails
 *   `days_over` weight inverted                → 0.21 · fails
 *   `edd_set` weight inverted                  → 0.47 · fails
 *
 * **What it does NOT catch** — stated rather than tuned away:
 *   `open_barriers` inverted → 0.71 · passes (just)
 *   `has_review` inverted    → 0.74 · passes
 *   `has_social_care` inverted → 0.80 · passes
 *   `has_transport` inverted → 0.85 · passes, and *improves* on baseline
 *
 * That last line is a finding, not noise: at n=12 the labels say a stretcher
 * ambulance blocks discharge harder than the model's -0.2 transport weight
 * allows. Re-fitting the weights to 12 hand labels would reintroduce exactly
 * the circularity this rework removed, so it is left as a signal for a real
 * dataset to settle.
 */
const RHO_GATE = 0.7
/** Narration numeric consistency — unchanged; it measures a different thing. */
const NARRATION_GATE = 0.9

/** Soonest first. The ranking target, not a duration. */
const DISCHARGE_WINDOWS = ['today', '1-2d', '3-5d', 'over-5d'] as const
type DischargeWindow = (typeof DISCHARGE_WINDOWS)[number]

interface EvalLabels {
  mffd: boolean
  edd: string | null
  barriers: Array<{ type: string }>
  expectedDischargeWindow?: DischargeWindow
  windowRationale?: string
}

/** Spearman ρ, with proper mid-ranks for ties — the truth labels are an
 *  ordinal with many ties, and integer ranking would fabricate an order
 *  between patients a human judged identical. */
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0])
    const r = new Array<number>(xs.length).fill(0)
    let i = 0
    while (i < order.length) {
      let j = i
      while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++
      const mid = (i + j) / 2 + 1
      for (let k = i; k <= j; k++) r[order[k]![1]] = mid
      i = j + 1
    }
    return r
  }
  const ra = rank(a)
  const rb = rank(b)
  const n = a.length
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
  const ma = mean(ra)
  const mb = mean(rb)
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb)
    da += (ra[i]! - ma) ** 2
    db += (rb[i]! - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema: { notes, encounters } })

  // Join to the encounter so length of stay is the real one. The eval used to
  // pass `days_admitted: 3` — the same fiction the product did — which meant it
  // could not have detected the dead input it was supposed to be scoring.
  const rows = await db
    .select({ note: notes, encounter: encounters })
    .from(notes)
    .innerJoin(encounters, eq(notes.encounterId, encounters.id))
    .where(isNotNull(notes.evalLabels))

  if (rows.length === 0) {
    console.error('No labelled notes. Run `pnpm db:seed:ward` first.')
    process.exit(1)
  }

  const now = new Date()
  const labelled = rows.filter(
    (r) => (r.note.evalLabels as EvalLabels).expectedDischargeWindow,
  )
  if (labelled.length === 0) {
    console.error(
      `\n❌ ${rows.length} labelled notes carry no \`expectedDischargeWindow\`.\n` +
        '   The v0.11.0 ground truth is hand-assigned in the seed — re-run\n' +
        '   `pnpm db:seed:ward` to pick it up. Refusing to fall back to the\n' +
        '   old feature-derived truth, which could not fail.',
    )
    await client.end()
    process.exit(1)
  }

  const features = labelled.map((r) => {
    const l = r.note.evalLabels as EvalLabels
    const types = new Set(l.barriers.map((b) => b.type))
    return {
      id: r.note.id,
      mffd: l.mffd,
      open_barriers: l.barriers.length,
      has_transport: types.has('transport'),
      has_social_care: types.has('social_care'),
      has_review: types.has('review'),
      days_admitted: daysAdmitted(r.encounter.admittedAt, now),
      edd_set: l.edd !== null,
      truthWindow: l.expectedDischargeWindow!,
    }
  })

  const res = await fetch(`${AI_URL}/forecast/discharge`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
    },
    body: JSON.stringify({ patients: features }),
  })
  if (!res.ok) throw new Error(`/forecast/discharge ${res.status}`)
  const { forecasts } = (await res.json()) as {
    forecasts: Array<{ id: string; p_discharge_24h: number }>
  }
  const pById = new Map(forecasts.map((f) => [f.id, f.p_discharge_24h]))

  // Truth: the hand-assigned window, negated so that "sooner" ranks the same
  // direction as "higher P(discharge)".
  const predicted: number[] = []
  const truth: number[] = []
  for (const f of features) {
    predicted.push(pById.get(f.id) ?? 0)
    truth.push(-DISCHARGE_WINDOWS.indexOf(f.truthWindow))
  }

  const rho = spearman(predicted, truth)

  // How the labels are distributed, because a target that is nearly all one
  // value would inflate ρ regardless of the model.
  const spread = DISCHARGE_WINDOWS.map(
    (w) => `${w}=${features.filter((f) => f.truthWindow === w).length}`,
  ).join(' ')

  const losKnown = features.filter((f) => f.days_admitted !== null).length

  // --- Narration numeric consistency ---------------------------------------
  // Every integer the briefing states must be one it was given: the LLM
  // narrates, it never invents figures. Run twice — once with a demand
  // projection and once without — because "omit, don't invent" is only
  // meaningful if the absent case is exercised.
  const stats: Record<string, number> = {
    occupied: 12,
    free: 4,
    mffd_delayed: 7,
    predicted_discharges_24h: 6,
    expected_admissions: 1.4,
    net_beds: 8.6,
    window_hours: 12,
  }
  const { briefing, consistency } = await narrationCheck(stats)

  const absentStats: Record<string, number> = {
    occupied: 12,
    free: 4,
    mffd_delayed: 7,
    predicted_discharges_24h: 6,
    window_hours: 12,
  }
  const absent = await narrationCheck(
    absentStats,
    'Only 3 admissions recorded in the last 7 days.',
  )
  const inventedPosition = statesANetPosition(absent.briefing)

  const pct = (x: number) => x.toFixed(2)
  // Gate BEFORE any score is printed, so a mocked run can never emit a
  // number that reads like a pass.
  assertLive()
  console.log('\n── Forecast & narration eval ────────────────────────')
  console.log(`  n (hand-labelled patients): ${features.length}`)
  console.log(`  label spread              : ${spread}`)
  console.log(`  length of stay known for  : ${losKnown}/${features.length}`)
  console.log(
    `  discharge Spearman ρ      : ${pct(rho)}  (gate ${pct(RHO_GATE)}, n=${features.length})`,
  )
  console.log(
    `  narration consistency     : ${pct(consistency)}  (gate ${pct(NARRATION_GATE)})`,
  )
  console.log(
    `  …with demand absent       : ${pct(absent.consistency)}  (gate ${pct(NARRATION_GATE)})`,
  )
  console.log(
    `  omits absent bed position : ${inventedPosition ? 'NO' : 'yes'}`,
  )
  console.log(`  briefing        → ${briefing}`)
  console.log(`  briefing (no demand) → ${absent.briefing}`)
  console.log('─────────────────────────────────────────────────────')
  console.log(
    `  Ground truth: ${features.length} hand-assigned discharge windows read from the note\n` +
      "  prose — not a function of the model's own features. The gate is the 99th\n" +
      '  percentile of a shuffled-label null at this n, so passing it means "not\n' +
      '  chance", NOT "accurate". It detects a dead input and an inverted mffd,\n' +
      '  edd_set or days_over weight; it does NOT detect an inverted barrier-type\n' +
      '  weight. See docs/evals.md before quoting this number anywhere.',
  )

  await client.end()
  if (
    rho < RHO_GATE ||
    consistency < NARRATION_GATE ||
    absent.consistency < NARRATION_GATE ||
    inventedPosition
  ) {
    console.error('\n❌ Forecast/narration eval below gate')
    if (inventedPosition) {
      console.error(
        '   The narrator stated a net bed position it was not given.',
      )
    }
    if (absent.consistency < NARRATION_GATE) {
      console.error(
        '   The narrator stated figures it was not given once demand was omitted.',
      )
    }
    process.exit(1)
  }
  console.log('\n✅ Forecast eval gates met.')
}

/** POST /forecast/narrate and score how many stated numbers it was given. */
async function narrationCheck(
  stats: Record<string, number>,
  demandUnavailableReason?: string,
): Promise<{ briefing: string; consistency: number }> {
  const res = await fetch(`${AI_URL}/forecast/narrate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
    },
    body: JSON.stringify({
      stats,
      ...(demandUnavailableReason
        ? { demand_unavailable_reason: demandUnavailableReason }
        : {}),
      at_risk: [{ label: 'A1', barriers: ['tto', 'transport'] }],
      predicted_discharges: [{ label: 'A1', p: 0.8, predicted_days: 1 }],
    }),
  })
  if (!res.ok) throw new Error(`/forecast/narrate ${res.status}`)
  const body = (await res.json()) as { briefing: string }
  recordProvenance('/forecast/narrate', body)
  const { briefing } = body

  // Allowed = every number the narrator was given (stats + their abs, plus the
  // predicted-discharge p and days), and any number inside the reason string,
  // which it is explicitly asked to quote back.
  const allowed = new Set<number>([1, 0.8])
  Object.values(stats).forEach((v) => {
    allowed.add(v)
    allowed.add(Math.abs(v))
  })
  ;(demandUnavailableReason?.match(/\d+(?:\.\d+)?/g) ?? [])
    .map(Number)
    .forEach((n) => allowed.add(n))
  // Decimal-aware extraction so "0.8" is one token, not "0" and "8".
  const stated = (briefing.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
  const consistency = stated.length
    ? stated.filter((n) => allowed.has(n)).length / stated.length
    : 1
  return { briefing, consistency }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
