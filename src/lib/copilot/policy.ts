import 'server-only'

import { cosineDistance, eq } from 'drizzle-orm'

import { db } from '@/db'
import { policyChunks, policyDocs } from '@/db/schema'
import { answerFromPassages, embedText, rerankPassages } from '@/lib/ai/client'
import {
  describeEmbeddingDrift,
  detectEmbeddingDrift,
  type EmbeddingDrift,
} from '@/lib/ai/embedding-model'
import type { Provenance } from '@/lib/ai/provenance'
import { logger } from '@/lib/logger'

const TOP_K = 8 // cosine ANN candidates
const TOP_N = 4 // passages sent to the LLM after reranking

export interface PolicyCitation {
  id: string
  text: string
  docTitle: string
  source: string
}

export interface PolicyAnswer {
  answer: string
  grounded: boolean
  citations: PolicyCitation[]
  reranked: boolean
  provenance: Provenance
  /**
   * Set when the question and the stored policy vectors were embedded by
   * different models. The retrieval below it is meaningless — see
   * `retrievePolicy` — so this must reach the user, not just the log.
   */
  embeddingDrift?: string
}

export interface PolicyPassage {
  id: string
  text: string
  docTitle: string
  source: string
  /** Which model built this chunk's vector; null for a pre-v0.11.0 row. */
  embeddingModel: string | null
}

export interface PolicyRetrieval {
  passages: PolicyPassage[]
  /**
   * Non-null when the query's embedding model disagrees with the models that
   * built the chunks it matched. Not an exception: the caller decides how to
   * present it, and every caller must present it somehow.
   */
  drift: EmbeddingDrift | null
}

/**
 * Embed a query and return the top-K policy chunks by cosine similarity, plus
 * whether the query and the chunks came from the same embedding model.
 *
 * The drift check exists because this search cannot fail on its own. Mock and
 * live vectors are both 1024-d, so seeding the KB in mock mode and querying it
 * in live mode produces a full result set of confidently-ranked, unrelated
 * passages — no error, no empty result, and a green "grounded" badge on the
 * answer built from them (spec v0.11.0 FR8).
 */
export async function retrievePolicy(
  query: string,
  k: number = TOP_K,
): Promise<PolicyRetrieval> {
  const { vector, model } = await embedText(query, 'query')
  const passages = await db
    .select({
      id: policyChunks.id,
      text: policyChunks.text,
      docTitle: policyDocs.title,
      source: policyDocs.source,
      embeddingModel: policyChunks.embeddingModel,
    })
    .from(policyChunks)
    .innerJoin(policyDocs, eq(policyChunks.docId, policyDocs.id))
    .orderBy(cosineDistance(policyChunks.embedding, vector))
    .limit(k)

  const drift = detectEmbeddingDrift(
    model,
    passages.map((p) => p.embeddingModel),
  )
  if (drift) {
    logger.error('policy embedding drift', {
      queryModel: drift.queryModel,
      storedModels: drift.storedModels.join(','),
      remedy: 'pnpm db:seed:policy',
    })
  }
  return { passages, drift }
}

/**
 * Policy RAG: embed the question (query NIM) → pgvector cosine ANN (top-K) →
 * rerank (top-N, cosine-order fallback) → grounded LLM answer with citations to
 * the policy passages actually used.
 */
export async function answerPolicyQuestion(
  question: string,
): Promise<PolicyAnswer> {
  const { passages: candidates, drift } = await retrievePolicy(question, TOP_K)

  if (drift) {
    // Refuse rather than answer. Every passage below was selected by comparing
    // two unrelated vector spaces, so an answer built on them would be a
    // fabrication wearing citations — the precise failure v0.11.0 exists to
    // stop. Surfaced to the user, not buried in the log.
    return {
      answer: describeEmbeddingDrift(drift),
      grounded: false,
      citations: [],
      reranked: false,
      provenance: 'mock',
      embeddingDrift: describeEmbeddingDrift(drift),
    }
  }

  if (candidates.length === 0) {
    return {
      answer: "I don't have policy that covers that.",
      grounded: false,
      citations: [],
      reranked: false,
      // Nothing was retrieved, so no model was asked — this refusal is ours.
      provenance: 'mock',
    }
  }

  type Candidate = (typeof candidates)[number]

  const { order, reranked } = await rerankPassages(
    question,
    candidates.map((c) => c.text),
    TOP_N,
  )
  const top: Candidate[] = order
    .map((i) => candidates[i])
    .filter((c): c is Candidate => Boolean(c))
    .slice(0, TOP_N)

  const result = await answerFromPassages(
    question,
    top.map((c) => ({ id: c.id, text: c.text, source: c.docTitle })),
  )

  const citations: PolicyCitation[] = result.citations
    .map((id) => top.find((c) => c.id === id))
    .filter((c): c is Candidate => Boolean(c))
    .map((c) => ({
      id: c.id,
      text: c.text,
      docTitle: c.docTitle,
      source: c.source,
    }))

  return {
    answer: result.answer,
    grounded: result.grounded,
    citations,
    reranked,
    provenance: result.provenance,
  }
}
