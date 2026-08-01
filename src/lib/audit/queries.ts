import 'server-only'

import { and, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm'

import { db } from '@/db'
import { accessAudit, users } from '@/db/schema'
import { requireWardAccess } from '@/lib/auth/ward-access'

/**
 * Admin audit listing (spec v0.12.0 FR7).
 *
 * Read-only over the append-only `access_audit` table: this module SELECTs and
 * nothing else. No application code may UPDATE or DELETE audit rows — the only
 * write path anywhere is the INSERT in `src/lib/audit/record.ts`.
 *
 * Gated through `requireWardAccess('view_access_audit', { any: true })`, which
 * under the current capability matrix resolves to admin-only and fails closed
 * (NFR1). Expected refusals return `{ ok: false, error }`, never throw.
 */

export const AUDIT_PAGE_SIZE = 50

export interface AuditListFilter {
  /** Exact actor user id, or a case-insensitive name/email fragment. */
  actor?: string
  /** Exact subject id (encounter / ward / patient id). */
  subjectId?: string
  from?: Date
  to?: Date
  /** Zero-based page, `AUDIT_PAGE_SIZE` rows per page. */
  page?: number
}

export interface AuditListRow {
  id: string
  actorUserId: string | null
  actorName: string | null
  actorEmail: string | null
  subjectType: string
  subjectId: string | null
  surface: string
  detail: unknown
  createdAt: Date
}

export type AuditListResult =
  | { ok: true; rows: AuditListRow[]; page: number; hasMore: boolean }
  | { ok: false; error: string }

export async function listAccessAudit(
  filter: AuditListFilter = {},
): Promise<AuditListResult> {
  const access = await requireWardAccess('view_access_audit', { any: true })
  if (!access.ok) return access

  const page = Math.max(0, Math.floor(filter.page ?? 0))

  const conditions: SQL[] = []
  const actor = filter.actor?.trim()
  if (actor) {
    // Admin convenience: an exact id match, or a substring of name/email.
    // `%`/`_` in the input widen the LIKE — harmless in an admin-only filter.
    const condition = or(
      eq(accessAudit.actorUserId, actor),
      ilike(users.email, `%${actor}%`),
      ilike(users.name, `%${actor}%`),
    )
    if (condition) conditions.push(condition)
  }
  const subjectId = filter.subjectId?.trim()
  if (subjectId) conditions.push(eq(accessAudit.subjectId, subjectId))
  if (filter.from) conditions.push(gte(accessAudit.createdAt, filter.from))
  if (filter.to) conditions.push(lte(accessAudit.createdAt, filter.to))

  // Fetch one extra row to know whether a next page exists.
  const rows = await db
    .select({
      id: accessAudit.id,
      actorUserId: accessAudit.actorUserId,
      actorName: users.name,
      actorEmail: users.email,
      subjectType: accessAudit.subjectType,
      subjectId: accessAudit.subjectId,
      surface: accessAudit.surface,
      detail: accessAudit.detail,
      createdAt: accessAudit.createdAt,
    })
    .from(accessAudit)
    .leftJoin(users, eq(users.id, accessAudit.actorUserId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(accessAudit.createdAt))
    .limit(AUDIT_PAGE_SIZE + 1)
    .offset(page * AUDIT_PAGE_SIZE)

  return {
    ok: true,
    rows: rows.slice(0, AUDIT_PAGE_SIZE),
    page,
    hasMore: rows.length > AUDIT_PAGE_SIZE,
  }
}
