import { config } from 'dotenv'
import { isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { notes } from '../db/schema'

/**
 * Forecast eval (spec v0.5.0). The deterministic discharge model should rank
 * patients sensibly: fit patients with fewer barriers rank as more dischargeable.
 * Uses the synthetic ground-truth labels for both features and truth, and checks
 * Spearman rank correlation between predicted P(discharge) and the truth score.
 * Gate: correlation ≥ 0.7.
 *
 *   docker compose up -d db ai && pnpm db:seed:ward && pnpm eval:forecast
 */
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''
const GATE = 0.7

interface EvalLabels {
  mffd: boolean
  edd: string | null
  barriers: Array<{ type: string }>
}

function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]) => {
    const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0])
    const r = new Array(xs.length).fill(0)
    idx.forEach(([, i], pos) => (r[i] = pos + 1))
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
    num += (ra[i] - ma) * (rb[i] - mb)
    da += (ra[i] - ma) ** 2
    db += (rb[i] - mb) ** 2
  }
  return da && db ? num / Math.sqrt(da * db) : 0
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema: { notes } })

  const rows = await db.select().from(notes).where(isNotNull(notes.evalLabels))
  if (rows.length === 0) {
    console.error('No labelled notes. Run `pnpm db:seed:ward` first.')
    process.exit(1)
  }

  const features = rows.map((note) => {
    const l = note.evalLabels as EvalLabels
    const types = new Set(l.barriers.map((b) => b.type))
    return {
      id: note.id,
      mffd: l.mffd,
      open_barriers: l.barriers.length,
      has_transport: types.has('transport'),
      has_social_care: types.has('social_care'),
      has_review: types.has('review'),
      days_admitted: 3,
      edd_set: l.edd !== null,
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

  // Truth: fit patients with fewer barriers are more dischargeable.
  const predicted: number[] = []
  const truth: number[] = []
  for (const f of features) {
    predicted.push(pById.get(f.id) ?? 0)
    truth.push((f.mffd ? 1 : 0) - 0.1 * f.open_barriers)
  }

  const rho = spearman(predicted, truth)

  // Narration numeric-consistency: every integer the briefing states must be one
  // of the numbers it was given (the LLM narrates, never invents figures).
  const stats: Record<string, number> = {
    occupied: 12,
    free: 4,
    mffd_delayed: 7,
    predicted_discharges_24h: 6,
    expected_admissions: 6,
    net_beds: -3,
    window_hours: 12,
  }
  const nres = await fetch(`${AI_URL}/forecast/narrate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
    },
    body: JSON.stringify({
      stats,
      at_risk: [{ label: 'A1', barriers: ['tto', 'transport'] }],
      predicted_discharges: [{ label: 'A1', p: 0.8, predicted_days: 1 }],
    }),
  })
  const { briefing } = (await nres.json()) as { briefing: string }
  // Allowed = every number the narrator was given (stats + their abs, plus the
  // predicted-discharge p and days).
  const allowed = new Set<number>([1, 0.8])
  Object.values(stats).forEach((v) => {
    allowed.add(v)
    allowed.add(Math.abs(v))
  })
  // Decimal-aware extraction so "0.8" is one token, not "0" and "8".
  const stated = (briefing.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
  const numConsistency = stated.length
    ? stated.filter((n) => allowed.has(n)).length / stated.length
    : 1

  const pct = (x: number) => x.toFixed(2)
  console.log('\n── Forecast & narration eval ────────────────────────')
  console.log(`  patients                  : ${features.length}`)
  console.log(`  discharge Spearman ρ      : ${pct(rho)}  (gate ${pct(GATE)})`)
  console.log(
    `  narration consistency     : ${pct(numConsistency)}  (gate 0.90)`,
  )
  console.log(`  briefing → ${briefing}`)
  console.log('─────────────────────────────────────────────────────')

  await client.end()
  if (rho < GATE || numConsistency < 0.9) {
    console.error('\n❌ Forecast/narration eval below gate')
    process.exit(1)
  }
  console.log('\n✅ Forecast eval gates met.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
