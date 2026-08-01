import 'server-only'

import { asc } from 'drizzle-orm'

import { db } from '@/db'
import { users } from '@/db/schema'

/** Someone a barrier can be handed to. */
export interface Assignee {
  id: string
  name: string
}

/**
 * People a barrier can be assigned to.
 *
 * Every registered user, for now. WardBeat has no clinical role model and no
 * ward membership yet — both land in v0.12.0, at which point this should narrow
 * to members of the relevant ward. Until then the picker is deliberately
 * simple rather than pretending to a structure that does not exist.
 */
export async function listAssignees(): Promise<Assignee[]> {
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .orderBy(asc(users.name))
    .limit(200)

  return rows.map((r) => ({
    id: r.id,
    name: r.name?.trim() || r.email || 'Unknown user',
  }))
}
