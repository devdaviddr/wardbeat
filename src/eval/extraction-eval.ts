import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { isNotNull } from 'drizzle-orm'
import postgres from 'postgres'

import { notes } from '../db/schema'
import { assertLive, recordProvenance } from './provenance-guard'

/**
 * Barrier-extraction eval harness (spec v0.2.0, NFR3). Calls the running `ai`
 * service for every synthetic note and scores extracted barrier *types* against
 * the planted ground truth (`notes.eval_labels`). Prints precision/recall/F1
 * and the MFFD accuracy, and exits non-zero if F1 < the gate (0.85) — so it can
 * act as a CI gate later.
 *
 *   docker compose up -d db ai   # ai service must be running
 *   pnpm db:seed:ward
 *   pnpm eval:extraction
 */
config({ path: '.env' })

const F1_GATE = 0.85
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''

interface EvalLabels {
  mffd: boolean
  edd: string | null
  barriers: Array<{ type: string; quote: string }>
}

interface ExtractResponse {
  mffd_flag: boolean
  barriers: Array<{ type: string }>
}

async function extract(noteId: string, text: string): Promise<ExtractResponse> {
  const res = await fetch(`${AI_URL}/extract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
    },
    body: JSON.stringify({ note_id: noteId, text }),
  })
  if (!res.ok) {
    throw new Error(`ai service ${res.status}: ${await res.text()}`)
  }
  const body = (await res.json()) as ExtractResponse
  recordProvenance('/extract', body)
  return body
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is required')

  const client = postgres(databaseUrl, { max: 1 })
  const db = drizzle(client, { schema: { notes } })

  const rows = await db.select().from(notes).where(isNotNull(notes.evalLabels))

  if (rows.length === 0) {
    console.error('No labelled notes found. Run `pnpm db:seed:ward` first.')
    process.exit(1)
  }

  let tp = 0
  let fp = 0
  let fn = 0
  let mffdCorrect = 0

  for (const note of rows) {
    const labels = note.evalLabels as EvalLabels
    const gold = new Set(labels.barriers.map((b) => b.type))
    const result = await extract(note.id, note.text)
    const pred = new Set(result.barriers.map((b) => b.type))

    for (const t of pred) {
      if (gold.has(t)) tp++
      else fp++
    }
    for (const t of gold) if (!pred.has(t)) fn++
    if (result.mffd_flag === labels.mffd) mffdCorrect++
  }

  const precision = tp + fp === 0 ? 1 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn)
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall)
  const mffdAcc = mffdCorrect / rows.length

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`
  // Gate BEFORE any score is printed, so a mocked run can never emit a
  // number that reads like a pass.
  assertLive()
  console.log('\n── Barrier-extraction eval ──────────────────────────')
  console.log(`  notes evaluated : ${rows.length}`)
  console.log(`  precision       : ${pct(precision)}`)
  console.log(`  recall          : ${pct(recall)}`)
  console.log(`  F1              : ${pct(f1)}  (gate ${pct(F1_GATE)})`)
  console.log(`  MFFD accuracy   : ${pct(mffdAcc)}`)
  console.log('─────────────────────────────────────────────────────')

  await client.end()

  if (f1 < F1_GATE) {
    console.error(`\n❌ F1 ${pct(f1)} below gate ${pct(F1_GATE)}`)
    process.exit(1)
  }
  console.log(`\n✅ F1 gate met.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
