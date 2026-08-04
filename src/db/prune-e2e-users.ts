import { config } from 'dotenv'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { users } from './schema'

// Removes the throwaway accounts the Playwright suite registers through the
// real signup flow. Every e2e spec mints its user as
// `<prefix>+${Date.now()}@example.com`, so that shape is the marker — and it
// cannot match a hand-made account like `demo@example.com`, which has no
// `+<digits>` tag. Run automatically by the e2e globalTeardown; also available
// as `pnpm db:prune:e2e` for when a crashed run leaves residue behind.
//
// Why this exists: the suite points at whatever DATABASE_URL is set, which
// locally is the dev database. Left unchecked it accumulated 324 users, which
// then filled every "assign to" picker in the app (`listAssignees()` returns
// all users).
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to prune e2e users')

// `+` followed by a 10-or-more digit epoch, at an @example.com address.
const E2E_EMAIL_PATTERN = '\\+[0-9]{10,}@example\\.com$'

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema: { users } })

  try {
    const deleted = await db
      .delete(users)
      .where(sql`${users.email} ~ ${E2E_EMAIL_PATTERN}`)
      .returning({ email: users.email })

    if (deleted.length === 0) {
      console.log('No e2e users to prune.')
    } else {
      console.log(`Pruned ${deleted.length} e2e user(s).`)
    }
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error('Failed to prune e2e users:', error)
  process.exitCode = 1
})
