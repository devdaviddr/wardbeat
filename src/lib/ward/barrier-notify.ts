import 'server-only'

import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'

import { db } from '@/db'
import { barriers, beds, encounters } from '@/db/schema'
import { logger } from '@/lib/logger'
import { sendPushNotification } from '@/lib/push'

/**
 * The first real ward events to reach the push channel.
 *
 * Web Push has been fully built since the platform baseline and wired to
 * exactly one event — new user registration. Assignment is its natural first
 * clinical use: being handed a barrier is precisely the moment someone needs to
 * know without watching the board.
 *
 * Both senders are best-effort. A failed notification must never fail the
 * clinical write that triggered it, so callers invoke these without awaiting
 * and every path swallows its own errors.
 *
 * NOTE: push payloads can appear on a lock screen, so these carry the bed label
 * and barrier type only — never a patient name or MRN.
 */

/** Bed label + barrier type for a barrier, or null if it has since vanished. */
async function describeBarrier(
  barrierId: string,
): Promise<{ bedLabel: string; type: string } | null> {
  const [row] = await db
    .select({ type: barriers.type, bedLabel: beds.label })
    .from(barriers)
    .innerJoin(encounters, eq(barriers.encounterId, encounters.id))
    .leftJoin(beds, eq(encounters.bedId, beds.id))
    .where(eq(barriers.id, barrierId))
    .limit(1)

  if (!row) return null
  return { bedLabel: row.bedLabel ?? 'Unbedded', type: row.type }
}

const TYPE_LABELS: Record<string, string> = {
  tto: 'TTOs',
  transport: 'Transport',
  social_care: 'Social care',
  review: 'Review',
  other: 'Barrier',
}

export async function notifyBarrierAssigned(
  barrierId: string,
  ownerUserId: string,
): Promise<void> {
  try {
    const detail = await describeBarrier(barrierId)
    if (!detail) return

    await sendPushNotification(ownerUserId, {
      title: `Assigned: ${TYPE_LABELS[detail.type] ?? 'Barrier'}`,
      body: `Bed ${detail.bedLabel} — you've been asked to chase this.`,
      url: '/dashboard',
    })
  } catch (err) {
    logger.error('barrier assignment notification failed', {
      barrierId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/**
 * Notify owners whose assigned barriers have passed their due time.
 *
 * Swept opportunistically on board read rather than by a scheduler — there is
 * no job runner in this deployment, and inventing one is out of scope for
 * v0.10.0. The consequence is honest and worth stating: an overdue barrier is
 * noticed the next time someone opens the board, not the moment it lapses.
 * `overdueNotifiedAt` makes the sweep idempotent so a refresh doesn't re-alert.
 */
export async function sweepOverdueBarriers(
  now: Date = new Date(),
): Promise<number> {
  try {
    const due = await db
      .select({ id: barriers.id, ownerUserId: barriers.ownerUserId })
      .from(barriers)
      .where(
        and(
          isNotNull(barriers.ownerUserId),
          isNotNull(barriers.dueAt),
          lt(barriers.dueAt, now),
          isNull(barriers.overdueNotifiedAt),
          inArray(barriers.status, ['pending', 'in_progress']),
        ),
      )
      .limit(50)

    if (due.length === 0) return 0

    for (const row of due) {
      const detail = await describeBarrier(row.id)
      if (detail && row.ownerUserId) {
        await sendPushNotification(row.ownerUserId, {
          title: `Overdue: ${TYPE_LABELS[detail.type] ?? 'Barrier'}`,
          body: `Bed ${detail.bedLabel} — past its due time.`,
          url: '/dashboard',
        })
      }
      await db
        .update(barriers)
        .set({ overdueNotifiedAt: now })
        .where(eq(barriers.id, row.id))
    }

    return due.length
  } catch (err) {
    logger.error('overdue barrier sweep failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return 0
  }
}
