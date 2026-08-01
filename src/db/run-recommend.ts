import { config } from 'dotenv'
import { and, cosineDistance, eq, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import {
  describeEmbeddingDrift,
  detectEmbeddingDrift,
} from '../lib/ai/embedding-model'
import type { Provenance } from '../lib/ai/provenance'
import * as schema from './schema'
import {
  encounters,
  policyChunks,
  policyDocs,
  recommendations,
  type ActionType,
} from './schema'

/**
 * Headless action-recommendation generation — CLI equivalent of the action
 * queue's "Generate" button. For each MFFD-but-delayed patient: retrieve policy,
 * call the recommender agent, persist `proposed` recommendations.
 *
 *   docker compose up -d db ai && pnpm db:seed:policy && pnpm db:extract
 *   pnpm db:recommend
 */
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''

const H = {
  'content-type': 'application/json',
  ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
}

async function post(path: string, body: unknown) {
  const res = await fetch(`${AI_URL}${path}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`)
  return res.json()
}

const ACTIONS = new Set<ActionType>([
  'chase_tto',
  'book_transport',
  'arrange_social_care',
  'escalate_review',
  'other',
])

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema })

  const active = await db.query.encounters.findMany({
    where: and(eq(encounters.mffdFlag, true), isNull(encounters.dischargedAt)),
    with: { bed: true, patient: true, barriers: true },
  })

  let generated = 0
  let patients_ = 0
  for (const enc of active) {
    if (enc.barriers.length === 0) continue
    patients_++
    const label = `Bed ${enc.bed?.label ?? '?'}`
    const query = `${enc.barriers.map((b) => b.type).join(' ')} discharge barrier policy`

    const emb = (await post('/embed', {
      texts: [query],
      input_type: 'query',
    })) as { embeddings: number[][]; model: string }
    const passages = await db
      .select({
        text: policyChunks.text,
        source: policyDocs.title,
        embeddingModel: policyChunks.embeddingModel,
      })
      .from(policyChunks)
      .innerJoin(policyDocs, eq(policyChunks.docId, policyDocs.id))
      .orderBy(cosineDistance(policyChunks.embedding, emb.embeddings[0]!))
      .limit(6)

    // This script does its own retrieval rather than going through
    // `retrievePolicy`, so it needs its own drift check — otherwise the CLI is
    // the one hole in FR8. Fail rather than write recommendations "grounded" in
    // passages matched across two unrelated 1024-d vector spaces.
    const drift = detectEmbeddingDrift(
      emb.model,
      passages.map((p) => p.embeddingModel),
    )
    if (drift) {
      throw new Error(describeEmbeddingDrift(drift))
    }

    const rec = (await post('/agent/recommend', {
      patient_label: label,
      barriers: enc.barriers.map((b) => ({
        id: b.id,
        type: b.type,
        quote: b.sourceQuote,
      })),
      policy: passages.map((p) => ({ text: p.text, source: p.source })),
    })) as {
      recommendations: Array<{
        barrier_id: string
        action_type: string
        title: string
        rationale: string
        priority: number
        citations: number[]
        grounded: boolean
      }>
      provenance?: Provenance
    }

    await db
      .delete(recommendations)
      .where(
        and(
          eq(recommendations.encounterId, enc.id),
          eq(recommendations.status, 'proposed'),
        ),
      )
    if (rec.recommendations.length === 0) continue
    await db.insert(recommendations).values(
      rec.recommendations.map((r) => ({
        encounterId: enc.id,
        barrierId: r.barrier_id,
        actionType: (ACTIONS.has(r.action_type as ActionType)
          ? r.action_type
          : 'other') as ActionType,
        title: r.title,
        rationale: r.rationale,
        priority: r.priority,
        grounded: r.grounded,
        // Same rule as the server action: a stored recommendation records how
        // it was produced, or nothing at all (v0.11.0 M5).
        provenance: rec.provenance ?? null,
        policyCitation: r.citations
          .map((n) => passages[n - 1])
          .filter(Boolean)
          .map((p) => ({ text: p!.text, source: p!.source })),
      })),
    )
    generated += rec.recommendations.length
    console.log(`  ${label}: ${rec.recommendations.length} recommendation(s)`)
  }

  console.log(`✅ ${generated} recommendation(s) for ${patients_} patient(s).`)
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
