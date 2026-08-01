import 'server-only'

import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { env } from '@/lib/env'
import * as schema from './schema'

/**
 * Single pooled postgres-js client per process. In development Next.js clears
 * the module cache on every hot reload, which would otherwise open a new pool
 * on each save and exhaust connections — so we stash the client on globalThis.
 */
const globalForDb = globalThis as unknown as {
  client: ReturnType<typeof postgres> | undefined
  shutdownHooked: boolean | undefined
}

const client =
  globalForDb.client ??
  postgres(env.DATABASE_URL, {
    max: env.NODE_ENV === 'production' ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 10,
  })

if (env.NODE_ENV !== 'production') {
  globalForDb.client = client
}

// Close the pool on shutdown so in-flight queries can drain. Guarded so hot
// reloads don't stack duplicate listeners.
if (
  !globalForDb.shutdownHooked &&
  typeof process !== 'undefined' &&
  typeof process.on === 'function'
) {
  globalForDb.shutdownHooked = true
  const close = () => {
    void client.end({ timeout: 5 })
  }
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
}

export const db = drizzle(client, {
  schema,
  logger: env.NODE_ENV === 'development',
})

export { schema }
export type Database = typeof db

/**
 * The raw postgres-js client. Needed only where a dedicated connection is
 * required — currently the extraction advisory lock, which must hold a
 * session-scoped lock across many separate queries. Prefer `db` everywhere else.
 */
export { client as sqlClient }
