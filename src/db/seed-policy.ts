import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { policyChunks, policyDocs } from './schema'

/**
 * Seeds the discharge-policy knowledge base for the copilot's RAG path
 * (spec v0.3.0). Synthetic, NHS-flavoured policy text — no real content.
 * Each doc is split into paragraph chunks, embedded via the `ai` service
 * (live NIM or offline mock), and written to pgvector.
 *
 *   docker compose up -d db ai
 *   pnpm db:seed:policy
 */
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''

interface Doc {
  title: string
  source: string
  body: string
}

const DOCS: Doc[] = [
  {
    title: 'Discharge Readiness Criteria',
    source: 'Trust Discharge Policy §2',
    body: `A patient is considered medically fit for discharge (MFFD) when the acute clinical problem that required admission has resolved or can be managed in the community, observations are stable within the patient's normal range, and no further inpatient-only investigations or treatments are required.

MFFD is a clinical decision recorded by the responsible medical team. A patient may be MFFD yet remain in a bed because of a non-clinical barrier such as medications, transport, or a social-care arrangement; these are tracked separately and must not delay the MFFD decision itself.

Patients on intravenous therapy are generally not fit for discharge until switched to an oral equivalent, unless a community IV pathway (OPAT) is arranged and documented.`,
  },
  {
    title: 'To-Take-Out (TTO) Medications',
    source: 'Trust Discharge Policy §4',
    body: `To-take-out (TTO) medications are the discharge medicines dispensed for the patient to take home. The responsible prescriber must complete the electronic TTO request as soon as the discharge decision is anticipated, ideally the day before.

Pharmacy aims to dispense routine TTOs within four hours of a completed request. Requests submitted before 10:00 are prioritised to support discharge before noon. Complex or controlled-drug TTOs may take longer and should be flagged early.

A discharge must not proceed until TTOs are dispensed and reconciled, unless the patient requires no discharge medication, which must be explicitly documented.`,
  },
  {
    title: 'Patient Transport',
    source: 'Trust Discharge Policy §5',
    body: `Non-emergency patient transport is booked by the ward clerk or nurse once a discharge is confirmed. Eligibility is based on clinical need — mobility, stretcher requirement, or oxygen — not convenience; patients able to travel by private car or with family should do so.

Transport should be requested as early as possible on the day of discharge. Stretcher and bariatric journeys require additional notice and should be booked the day before where the discharge is planned.

Family collection is not a transport barrier and does not require a booking; record the expected collection time instead.`,
  },
  {
    title: 'Discharge to Assess and Social Care',
    source: 'Trust Discharge Policy §7',
    body: `Where a patient needs ongoing care at home, a restart or new package of care (POC) is arranged through the integrated discharge team. A new or increased POC follows the Discharge to Assess (D2A) pathway and should be referred as soon as the need is identified.

Care-home placements require social-work involvement and, for a new placement, may take several days; these patients are flagged as complex discharges and reviewed daily at the board round.

District-nurse referrals for wound care, injections, or ongoing observation must be arranged before discharge and confirmed as accepted by the community team.`,
  },
  {
    title: 'Awaiting Specialist Review',
    source: 'Trust Discharge Policy §6',
    body: `Some discharges depend on a specialist review or investigation result — for example a cardiology review of an echocardiogram, a microbiology opinion on antibiotic duration, or an occupational-therapy home assessment.

The requesting team must state clearly what is being awaited and why it blocks discharge. Routine "reassess in 24–48 hours" for an unwell inpatient is not a discharge barrier; only a named, discharge-critical review counts.

Where a review is the sole outstanding barrier, escalate to the relevant team by mid-morning to preserve the chance of a same-day discharge.`,
  },
]

function chunk(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0)
}

/**
 * Embed a batch and keep the model id the AI plane stamped on the response.
 * Storing it alongside the vector is what makes seed/query drift detectable
 * later (spec v0.11.0 FR8) — a mock vector and a live one are both 1024-d, so
 * nothing else distinguishes them.
 */
async function embedPassages(
  texts: string[],
): Promise<{ embeddings: number[][]; model: string }> {
  const res = await fetch(`${AI_URL}/embed`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
    },
    body: JSON.stringify({ texts, input_type: 'passage' }),
  })
  if (!res.ok) throw new Error(`ai /embed ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as { embeddings: number[][]; model: string }
  if (!json.model) {
    throw new Error(
      'ai /embed returned no model id — cannot record which model built these vectors',
    )
  }
  return json
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema: { policyDocs, policyChunks } })

  console.log('🧹 Clearing policy KB…')
  await db.delete(policyChunks)
  await db.delete(policyDocs)

  let totalChunks = 0
  const modelsUsed = new Set<string>()
  for (const doc of DOCS) {
    const [row] = await db
      .insert(policyDocs)
      .values({ title: doc.title, source: doc.source })
      .returning()
    if (!row) throw new Error(`Failed to insert doc ${doc.title}`)

    const chunks = chunk(doc.body)
    const { embeddings, model } = await embedPassages(chunks)
    modelsUsed.add(model)
    await db.insert(policyChunks).values(
      chunks.map((text, i) => ({
        docId: row.id,
        ordinal: i,
        text,
        embedding: embeddings[i],
        embeddingModel: model,
      })),
    )
    totalChunks += chunks.length
    console.log(`📄 ${doc.title} — ${chunks.length} chunks`)
  }

  const models = [...modelsUsed].join(', ')
  console.log(
    `✅ Policy KB seeded: ${DOCS.length} docs, ${totalChunks} embedded chunks ` +
      `(embedding model: ${models}).`,
  )
  if (modelsUsed.has('mock')) {
    console.warn(
      '⚠️  These vectors came from the deterministic mock. Re-run this seed ' +
        'after switching to a live embedding model — otherwise policy search ' +
        'compares two unrelated 1024-d spaces and the copilot will say so.',
    )
  }
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
