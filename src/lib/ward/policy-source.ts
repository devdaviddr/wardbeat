'use server'

import { asc, eq, or } from 'drizzle-orm'

import { db } from '@/db'
import { policyChunks, policyDocs } from '@/db/schema'
import { getCurrentSession } from '@/lib/auth/session'

export interface PolicyDocView {
  title: string
  source: string
  chunks: Array<{ ordinal: number; text: string; cited: boolean }>
}

/**
 * Resolve a policy citation back to its full source document so the UI can open
 * it. Copilot citations carry the chunk `id`; recommendation citations only
 * carry the passage `text`, so we match on that; as a last resort we match the
 * document by its `source`/title label. Returns the whole document (all passages
 * in order) with the cited one flagged, or null if it can't be found.
 *
 * Read-only and auth-gated — returns nothing to an unauthenticated caller.
 */
export async function getPolicySource(input: {
  chunkId?: string
  text?: string
  source?: string
}): Promise<PolicyDocView | null> {
  const session = await getCurrentSession()
  if (!session?.user) return null

  let docId: string | undefined
  let citedChunkId: string | undefined

  if (input.chunkId) {
    const row = await db.query.policyChunks.findFirst({
      where: eq(policyChunks.id, input.chunkId),
      columns: { id: true, docId: true },
    })
    if (row) {
      docId = row.docId
      citedChunkId = row.id
    }
  }
  if (!docId && input.text) {
    const row = await db.query.policyChunks.findFirst({
      where: eq(policyChunks.text, input.text),
      columns: { id: true, docId: true },
    })
    if (row) {
      docId = row.docId
      citedChunkId = row.id
    }
  }
  if (!docId && input.source) {
    const doc = await db.query.policyDocs.findFirst({
      where: or(
        eq(policyDocs.title, input.source),
        eq(policyDocs.source, input.source),
      ),
      columns: { id: true },
    })
    if (doc) docId = doc.id
  }
  if (!docId) return null

  const doc = await db.query.policyDocs.findFirst({
    where: eq(policyDocs.id, docId),
    columns: { title: true, source: true },
  })
  if (!doc) return null

  const chunks = await db.query.policyChunks.findMany({
    where: eq(policyChunks.docId, docId),
    orderBy: [asc(policyChunks.ordinal)],
    columns: { id: true, ordinal: true, text: true },
  })

  return {
    title: doc.title,
    source: doc.source,
    chunks: chunks.map((c) => ({
      ordinal: c.ordinal,
      text: c.text,
      cited: c.id === citedChunkId,
    })),
  }
}
