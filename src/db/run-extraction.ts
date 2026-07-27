import { config } from 'dotenv'
import { asc } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import {
  persistExtraction,
  type PersistableExtraction,
} from './persist-extraction'
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
  return res.json() as Promise<PersistableExtraction>
}

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, {
    schema: { notes, encounters, barriers, aiExtractions },
  })

  const rows = await db.select().from(notes).orderBy(asc(notes.writtenAt))
  let processed = 0
  let barrierCount = 0

  // Sequential — the CLI pool is `max: 1`, so concurrent transactions would
  // just queue. The ward board (pooled) fans these out; here order is fine.
  for (const note of rows) {
    const result = await extract(note.id, note.encounterId, note.text)
    const saved = await persistExtraction(db, note, result)
    barrierCount += saved.barriers
    processed++
  }

  console.log(`✅ Extracted ${processed} notes → ${barrierCount} barriers.`)
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
