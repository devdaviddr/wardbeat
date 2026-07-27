import { config } from 'dotenv'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { aiExtractions, barriers, encounters, notes } from './schema'

/**
 * Headless barrier extraction — the CLI equivalent of the ward board's
 * "Run extraction" button. Reads every note, calls the `ai` service, and
 * persists barriers + denormalised MFFD/EDD. Handy for demos and eval setup.
 *
 *   docker compose up -d db ai && pnpm db:seed:ward && pnpm db:extract
 */
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')
const AI_URL = process.env.WARDBEAT_AI_URL ?? 'http://localhost:8000'
const AI_TOKEN =
  process.env.WARDBEAT_AI_SERVICE_TOKEN ?? process.env.AI_SERVICE_TOKEN ?? ''

async function extract(noteId: string, encounterId: string, text: string) {
  const res = await fetch(`${AI_URL}/extract`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(AI_TOKEN ? { 'x-service-token': AI_TOKEN } : {}),
    },
    body: JSON.stringify({ note_id: noteId, encounter_id: encounterId, text }),
  })
  if (!res.ok) throw new Error(`ai /extract ${res.status}: ${await res.text()}`)
  return res.json() as Promise<{
    model: string
    edd: string | null
    mffd_flag: boolean
    escalations: string[]
    grounded: boolean
    barriers: Array<{
      type: string
      status: string
      source: { start: number | null; end: number | null; quote: string }
      confidence: number
    }>
  }>
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, {
    schema: { notes, encounters, barriers, aiExtractions },
  })

  const rows = await db.select().from(notes).orderBy(asc(notes.writtenAt))
  let processed = 0
  let barrierCount = 0

  for (const note of rows) {
    const result = await extract(note.id, note.encounterId, note.text)
    await db.delete(barriers).where(eq(barriers.sourceNoteId, note.id))
    await db.delete(aiExtractions).where(eq(aiExtractions.noteId, note.id))
    const [extraction] = await db
      .insert(aiExtractions)
      .values({
        noteId: note.id,
        model: result.model,
        edd: result.edd ?? null,
        mffdFlag: result.mffd_flag,
        escalations: result.escalations,
        grounded: result.grounded,
        rawJson: JSON.stringify(result),
      })
      .returning()
    if (result.barriers.length > 0) {
      await db.insert(barriers).values(
        result.barriers.map((b) => ({
          encounterId: note.encounterId,
          sourceNoteId: note.id,
          extractionId: extraction?.id,
          type: b.type as
            'tto' | 'transport' | 'social_care' | 'review' | 'other',
          status: b.status as 'pending' | 'in_progress' | 'cleared',
          sourceQuote: b.source.quote,
          sourceStart: b.source.start ?? null,
          sourceEnd: b.source.end ?? null,
          confidence: b.confidence,
        })),
      )
      barrierCount += result.barriers.length
    }
    await db
      .update(encounters)
      .set({
        mffdFlag: result.mffd_flag,
        edd: result.edd ?? null,
        lastExtractedAt: new Date(),
      })
      .where(eq(encounters.id, note.encounterId))
    processed++
  }

  console.log(`✅ Extracted ${processed} notes → ${barrierCount} barriers.`)
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
