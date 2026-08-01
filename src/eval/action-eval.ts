import { config } from 'dotenv'
import { cosineDistance, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { policyChunks, policyDocs } from '../db/schema'
import { assertLive, recordProvenance } from './provenance-guard'

/**
 * Action-recommendation eval (spec v0.4.0). For labelled barriers, retrieve
 * policy → recommend → check the action_type matches the expected mapping
 * (appropriateness) and the rationale is policy-grounded. Gates: both ≥ 0.9.
 *
 *   docker compose up -d db ai && pnpm db:seed:policy && pnpm eval:actions
 */
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''
const GATE = 0.9

const H = {
  'content-type': 'application/json',
  ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
}

interface Case {
  type: string
  quote: string
  expect: string // expected action_type
}

const CASES: Case[] = [
  { type: 'tto', quote: 'Awaiting TTOs from pharmacy', expect: 'chase_tto' },
  {
    type: 'transport',
    quote: 'Transport home not yet booked',
    expect: 'book_transport',
  },
  {
    type: 'social_care',
    quote: 'Awaiting restart of package of care',
    expect: 'arrange_social_care',
  },
  {
    type: 'review',
    quote: 'Awaiting cardiology review of echocardiogram',
    expect: 'escalate_review',
  },
  {
    type: 'tto',
    quote: 'TTOs to be dispensed by pharmacy',
    expect: 'chase_tto',
  },
  {
    type: 'social_care',
    quote: 'district nurse referral for wound care',
    expect: 'arrange_social_care',
  },
]

async function post(path: string, body: unknown) {
  const res = await fetch(`${AI_URL}${path}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
  const parsed = await res.json()
  recordProvenance(path, parsed)
  return parsed
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema: { policyChunks, policyDocs } })

  let appropriate = 0
  let grounded = 0

  for (const c of CASES) {
    const emb = (await post('/embed', {
      texts: [`${c.type} discharge barrier policy`],
      input_type: 'query',
    })) as { embeddings: number[][] }
    const passages = await db
      .select({ text: policyChunks.text, source: policyDocs.title })
      .from(policyChunks)
      .innerJoin(policyDocs, eq(policyChunks.docId, policyDocs.id))
      .orderBy(cosineDistance(policyChunks.embedding, emb.embeddings[0]!))
      .limit(6)

    const res = (await post('/agent/recommend', {
      patient_label: 'Bed X',
      barriers: [{ id: 'b', type: c.type, quote: c.quote }],
      policy: passages.map((p) => ({ text: p.text, source: p.source })),
    })) as {
      recommendations: Array<{
        action_type: string
        grounded: boolean
        title: string
      }>
    }
    const rec = res.recommendations[0]
    const ok = rec?.action_type === c.expect
    if (ok) appropriate++
    if (rec?.grounded) grounded++
    console.log(
      `${ok ? '✓' : '✗'} ${c.type} → ${rec?.action_type ?? 'none'} (${rec?.title ?? ''})`,
    )
  }

  const n = CASES.length
  const appr = appropriate / n
  const grnd = grounded / n
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  // Gate BEFORE any score is printed, so a mocked run can never emit a
  // number that reads like a pass.
  assertLive()
  console.log('\n── Action-recommendation eval ───────────────────────')
  console.log(`  cases              : ${n}`)
  console.log(`  action-appropriate : ${pct(appr)}  (gate ${pct(GATE)})`)
  console.log(`  policy-grounded    : ${pct(grnd)}  (gate ${pct(GATE)})`)
  console.log('─────────────────────────────────────────────────────')

  await client.end()
  if (appr < GATE || grnd < GATE) {
    console.error('\n❌ Action eval below gate')
    process.exit(1)
  }
  console.log('\n✅ Action eval gates met.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
