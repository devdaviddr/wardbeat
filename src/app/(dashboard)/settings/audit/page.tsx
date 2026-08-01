import { Metadata } from 'next'
import Link from 'next/link'

import {
  AUDIT_PAGE_SIZE,
  listAccessAudit,
  type AuditListRow,
} from '@/lib/audit/queries'

export const metadata: Metadata = { title: 'Access audit' }

/**
 * Admin-only access-audit view (spec v0.12.0 FR7). Deliberately plain: a
 * filter form, a table, prev/next. The real gate is server-side in
 * `listAccessAudit` (admin capability, fails closed) — this page just renders
 * whatever that returns.
 */

interface AuditSearchParams {
  actor?: string
  subject?: string
  from?: string
  to?: string
  page?: string
}

function parseDay(
  value: string | undefined,
  endOfDay: boolean,
): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const date = new Date(
    endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`,
  )
  return Number.isNaN(date.getTime()) ? undefined : date
}

/** Deterministic UTC render — server component, no client hydration. */
function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

function pageHref(params: AuditSearchParams, page: number): string {
  const qs = new URLSearchParams()
  if (params.actor) qs.set('actor', params.actor)
  if (params.subject) qs.set('subject', params.subject)
  if (params.from) qs.set('from', params.from)
  if (params.to) qs.set('to', params.to)
  if (page > 0) qs.set('page', String(page))
  const query = qs.toString()
  return query ? `/settings/audit?${query}` : '/settings/audit'
}

function detailPreview(detail: unknown): string {
  if (detail == null) return ''
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

export default async function AccessAuditPage({
  searchParams,
}: {
  searchParams: Promise<AuditSearchParams>
}) {
  const params = await searchParams
  const pageParam = Number.parseInt(params.page ?? '0', 10)
  const page = Number.isNaN(pageParam) ? 0 : Math.max(0, pageParam)

  const result = await listAccessAudit({
    actor: params.actor,
    subjectId: params.subject,
    from: parseDay(params.from, false),
    to: parseDay(params.to, true),
    page,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Access audit</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Who accessed which subject, when, and through which surface.
          Append-only — records cannot be edited or deleted.{' '}
          <Link href="/settings" className="underline">
            Back to settings
          </Link>
        </p>
      </div>

      {!result.ok ? (
        <p className="text-sm">{result.error}</p>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">
                Actor (id, name or email)
              </span>
              <input
                type="text"
                name="actor"
                defaultValue={params.actor ?? ''}
                className="bg-background w-56 rounded-md border px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Subject id</span>
              <input
                type="text"
                name="subject"
                defaultValue={params.subject ?? ''}
                className="bg-background w-56 rounded-md border px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">From</span>
              <input
                type="date"
                name="from"
                defaultValue={params.from ?? ''}
                className="bg-background rounded-md border px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">To</span>
              <input
                type="date"
                name="to"
                defaultValue={params.to ?? ''}
                className="bg-background rounded-md border px-2 py-1"
              />
            </label>
            <button
              type="submit"
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 font-medium"
            >
              Filter
            </button>
          </form>

          {result.rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No audit records match.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground border-b text-xs uppercase">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Surface</th>
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row: AuditListRow) => (
                    <tr key={row.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono whitespace-nowrap">
                        {formatUtc(row.createdAt)}
                      </td>
                      <td className="px-3 py-2">
                        {row.actorName ?? '—'}
                        <span className="text-muted-foreground block text-xs">
                          {row.actorEmail ?? row.actorUserId ?? 'deleted user'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.surface}</td>
                      <td className="px-3 py-2">
                        {row.subjectType}
                        {row.subjectId && (
                          <span className="text-muted-foreground block font-mono text-xs">
                            {row.subjectId}
                          </span>
                        )}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">
                        {detailPreview(row.detail)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-4 text-sm">
            {result.page > 0 ? (
              <Link
                href={pageHref(params, result.page - 1)}
                className="underline"
              >
                Previous
              </Link>
            ) : (
              <span className="text-muted-foreground">Previous</span>
            )}
            <span className="text-muted-foreground">
              Page {result.page + 1} · {AUDIT_PAGE_SIZE}/page
            </span>
            {result.hasMore ? (
              <Link
                href={pageHref(params, result.page + 1)}
                className="underline"
              >
                Next
              </Link>
            ) : (
              <span className="text-muted-foreground">Next</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
