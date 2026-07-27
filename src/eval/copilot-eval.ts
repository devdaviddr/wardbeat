import { config } from 'dotenv'
import { cosineDistance, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { policyChunks, policyDocs } from '../db/schema'

/**
 * Copilot eval (spec v0.3.0). Policy path: for each labelled question, embed →
 * pgvector cosine top-K → rerank → check the expected policy doc is retrieved
 * (hit-rate) and the answer is grounded. Gates: hit-rate ≥ 0.9, grounded ≥ 0.9.
 *
 *   docker compose up -d db ai && pnpm db:seed:policy && pnpm eval:copilot
 */
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''
const GATE = 0.9
const TOP_K = 8
const TOP_N = 4

const H = {
  'content-type': 'application/json',
  ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
}

interface Q {
  q: string
  expectDoc: string // substring of the expected policy doc title
}

const QUESTIONS: Q[] = [
  { q: 'Who books patient transport for a discharge?', expectDoc: 'Transport' },
  { q: 'How quickly should pharmacy dispense TTOs?', expectDoc: 'To-Take-Out' },
  {
    q: 'When is a patient medically fit for discharge?',
    expectDoc: 'Readiness',
  },
  {
    q: 'What is needed to restart a package of care?',
    expectDoc: 'Social Care',
  },
  {
    q: 'Is a routine reassessment a discharge barrier?',
    expectDoc: 'Specialist',
  },
  {
    q: 'Can a patient on IV antibiotics be discharged?',
    expectDoc: 'Readiness',
  },
]

// Ward-state path: does the model translate the question into the right
// structured filter? Each expected key must match the produced intent.
interface WardQ {
  q: string
  expect: Record<string, unknown>
}
const WARD_QUESTIONS: WardQ[] = [
  {
    q: 'Which patients are fit but waiting on transport?',
    expect: { mffd: true, barrier: 'transport' },
  },
  {
    q: 'How many beds are free?',
    expect: { aggregation: 'count', free: true },
  },
  { q: 'Who is medically fit for discharge?', expect: { mffd: true } },
  { q: 'Which patients are waiting on TTOs?', expect: { barrier: 'tto' } },
  {
    q: 'Is anyone waiting on social care?',
    expect: { barrier: 'social_care' },
  },
  {
    q: 'Which fit patients have an EDD of today?',
    expect: { mffd: true, edd_today: true },
  },
]

async function post(path: string, body: unknown) {
  const res = await fetch(`${AI_URL}${path}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema: { policyChunks, policyDocs } })

  let hits = 0
  let grounded = 0
  let rerankedSeen = false

  for (const item of QUESTIONS) {
    const emb = (await post('/embed', {
      texts: [item.q],
      input_type: 'query',
    })) as { embeddings: number[][] }
    const queryVec = emb.embeddings[0]!

    const candidates = await db
      .select({
        id: policyChunks.id,
        text: policyChunks.text,
        docTitle: policyDocs.title,
      })
      .from(policyChunks)
      .innerJoin(policyDocs, eq(policyChunks.docId, policyDocs.id))
      .orderBy(cosineDistance(policyChunks.embedding, queryVec))
      .limit(TOP_K)

    const rr = (await post('/copilot/rerank', {
      query: item.q,
      passages: candidates.map((c) => c.text),
      top_n: TOP_N,
    })) as { order: number[]; reranked: boolean }
    rerankedSeen = rerankedSeen || rr.reranked
    const top = rr.order.map((i) => candidates[i]).filter(Boolean) as {
      id: string
      text: string
      docTitle: string
    }[]

    const hit = top.some((c) => c.docTitle.includes(item.expectDoc))
    if (hit) hits++

    const ans = (await post('/copilot/answer', {
      question: item.q,
      passages: top.map((c) => ({
        id: c.id,
        text: c.text,
        source: c.docTitle,
      })),
    })) as { answer: string; grounded: boolean }
    if (ans.grounded) grounded++

    console.log(
      `${hit ? '✓' : '✗'} ${item.q}\n    → ${ans.answer.slice(0, 96)}`,
    )
  }

  // Ward-state: query-intent accuracy.
  let intentOk = 0
  for (const item of WARD_QUESTIONS) {
    const got = (await post('/copilot/query-intent', {
      question: item.q,
    })) as Record<string, unknown>
    const ok = Object.entries(item.expect).every(([k, v]) => got[k] === v)
    if (ok) intentOk++
    console.log(`${ok ? '✓' : '✗'} intent: ${item.q} → ${JSON.stringify(got)}`)
  }

  const n = QUESTIONS.length
  const hitRate = hits / n
  const groundedRate = grounded / n
  const intentAcc = intentOk / WARD_QUESTIONS.length
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  console.log('\n── Copilot eval ─────────────────────────────────────')
  console.log(`  policy questions   : ${n}`)
  console.log(`  retrieval hit-rate : ${pct(hitRate)}  (gate ${pct(GATE)})`)
  console.log(
    `  answer grounded    : ${pct(groundedRate)}  (gate ${pct(GATE)})`,
  )
  console.log(
    `  reranker used      : ${rerankedSeen ? 'yes' : 'no (cosine order)'}`,
  )
  console.log(`  ward-state qs      : ${WARD_QUESTIONS.length}`)
  console.log(`  query-intent acc   : ${pct(intentAcc)}  (gate ${pct(GATE)})`)
  console.log('─────────────────────────────────────────────────────')

  await client.end()
  if (hitRate < GATE || groundedRate < GATE || intentAcc < GATE) {
    console.error('\n❌ Copilot eval below gate')
    process.exit(1)
  }
  console.log('\n✅ Copilot eval gates met.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
