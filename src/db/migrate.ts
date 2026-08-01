import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

import { embeddingModelFromEnv } from '../lib/ai/embedding-model'

// Standalone migration runner — invoked by `pnpm db:migrate` and the Docker
// entrypoint. Runs outside Next.js, so load .env explicitly.
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations')
}

/**
 * Data step for migration 0014 (spec v0.11.0 FR8).
 *
 * `policy_chunks.embedding_model` records which model produced each stored
 * vector. Rows written before 0014 have no such record, and plain SQL cannot
 * find out — the answer lives in the AI plane's environment, not the database.
 * So the schema migration adds the column and this backfills it.
 *
 * The backfill is an **assumption, not a fact**: it stamps existing rows with
 * the model that is configured *now*, which is only correct if the knowledge
 * base was seeded under the same configuration. If it was seeded under
 * `NIM_MOCK=true` and this runs with a live key, the assumption is wrong in
 * exactly the direction that hides the bug — hence the noise below. The remedy
 * is to re-seed: `pnpm db:seed:policy`.
 *
 * Idempotent: only null rows are touched, and every row written from v0.11.0
 * onward carries a real value from the `/embed` response.
 */
async function backfillEmbeddingModel(sql: postgres.Sql): Promise<void> {
  const hasColumn = await sql`
    select 1 from information_schema.columns
    where table_name = 'policy_chunks' and column_name = 'embedding_model'
  `
  if (hasColumn.length === 0) return

  const [pending] = await sql`
    select count(*)::int as count from policy_chunks where embedding_model is null
  `
  const count = (pending?.count as number | undefined) ?? 0
  if (count === 0) return

  const assumed = embeddingModelFromEnv(process.env)
  await sql`
    update policy_chunks set embedding_model = ${assumed} where embedding_model is null
  `

  console.warn(
    [
      '',
      '⚠️  ────────────────────────────────────────────────────────────────────',
      `⚠️  BACKFILLED ${count} policy chunk(s) with embedding_model = "${assumed}".`,
      '⚠️',
      '⚠️  THIS IS AN ASSUMPTION, NOT A FACT. Those vectors were embedded before',
      '⚠️  WardBeat recorded which model produced them; they may have come from',
      '⚠️  the deterministic mock even if a live model is configured now.',
      '⚠️',
      '⚠️  If the policy knowledge base was seeded under a different NIM_MOCK /',
      '⚠️  NIM_EMBED_MODEL setting, policy search is silently returning nonsense',
      '⚠️  (both vector spaces are 1024-d, so pgvector reports no error).',
      '⚠️',
      '⚠️  Remedy: re-seed the policy KB so the vectors and the label agree —',
      '⚠️      pnpm db:seed:policy',
      '⚠️  ────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  )
}

async function main() {
  // A dedicated single-connection client; `max: 1` is required for migrations.
  const migrationClient = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(migrationClient)

  console.log('⏳ Running migrations...')
  const start = Date.now()
  await migrate(db, { migrationsFolder: './drizzle' })
  console.log(`✅ Migrations complete in ${Date.now() - start}ms`)

  await backfillEmbeddingModel(migrationClient)

  await migrationClient.end()
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Migration failed')
  console.error(err)
  process.exit(1)
})
