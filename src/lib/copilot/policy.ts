import 'server-only'

import { cosineDistance, eq } from 'drizzle-orm'

import { db } from '@/db'
import { policyChunks, policyDocs } from '@/db/schema'
import { answerFromPassages, embedText, rerankPassages } from '@/lib/ai/client'

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
}

/**
 * Policy RAG: embed the question (query NIM) → pgvector cosine ANN (top-K) →
 * rerank (top-N, cosine-order fallback) → grounded LLM answer with citations to
 * the policy passages actually used.
 */
export async function answerPolicyQuestion(
  question: string,
): Promise<PolicyAnswer> {
  const queryVec = await embedText(question, 'query')

  const candidates = await db
    .select({
      id: policyChunks.id,
      text: policyChunks.text,
      docTitle: policyDocs.title,
      source: policyDocs.source,
    })
    .from(policyChunks)
    .innerJoin(policyDocs, eq(policyChunks.docId, policyDocs.id))
    .orderBy(cosineDistance(policyChunks.embedding, queryVec))
    .limit(TOP_K)

  if (candidates.length === 0) {
    return {
      answer: "I don't have policy that covers that.",
      grounded: false,
      citations: [],
      reranked: false,
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
  }
}
