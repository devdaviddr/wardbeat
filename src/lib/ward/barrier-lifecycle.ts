'use server'

import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { db } from '@/db'
import {
  type BarrierEventKind,
  type BarrierType,
  barrierEvents,
  barriers,
  barrierSuppressions,
  notes,
} from '@/db/schema'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'
import { notifyBarrierAssigned } from '@/lib/ward/barrier-notify'
import { barrierFingerprint } from '@/lib/ward/reconcile'

/**
 * The barrier lifecycle — assign, chase, clear (spec v0.10.0).
 *
 * Before this release a barrier could be raised and approved but never
 * finished: `cleared` existed in the schema and nothing set it, so the ward's
 * open-barrier count only ever rose. These actions are the missing half.
 *
 * Every one of them is a single transaction that writes the state change and
 * its lifecycle event together — a status change without its event would be an
 * unattributable edit to clinical data. Expected failures return
 * `{ ok: false, error }` rather than throwing, because Next.js redacts thrown
 * error messages in production builds (see CLAUDE.md).
 */

export type LifecycleResult = { ok: true } | { ok: false; error: string }

const REVALIDATE_PATHS = ['/dashboard', '/ward'] as const

function revalidateBoard(): void {
  for (const path of REVALIDATE_PATHS) revalidatePath(path)
}

/** Statuses from which a barrier can still be worked on. */
function isOpen(status: string): boolean {
  return status === 'pending' || status === 'in_progress'
}

async function currentUserId(): Promise<string | null> {
  const session = await getCurrentSession()
  return session?.user?.id ?? null
}

interface EventInput {
  barrierId: string
  kind: BarrierEventKind
  actorUserId: string
  body?: string | null
  meta?: Record<string, unknown> | null
}

/**
 * Loads a barrier and applies a change plus its event atomically. Every
 * lifecycle action funnels through here so none can forget the event or the
 * transaction.
 */
async function mutateBarrier(
  barrierId: string,
  actorUserId: string,
  build: (barrier: typeof barriers.$inferSelect) =>
    | {
        patch: Partial<typeof barriers.$inferInsert>
        event: Omit<EventInput, 'barrierId' | 'actorUserId'>
      }
    | { error: string },
): Promise<LifecycleResult> {
  try {
    return await db.transaction(async (tx) => {
      const [barrier] = await tx
        .select()
        .from(barriers)
        .where(eq(barriers.id, barrierId))
        .for('update')

      if (!barrier) return { ok: false as const, error: 'Barrier not found' }

      const plan = build(barrier)
      if ('error' in plan) return { ok: false as const, error: plan.error }

      await tx
        .update(barriers)
        .set(plan.patch)
        .where(eq(barriers.id, barrierId))
      await tx.insert(barrierEvents).values({
        barrierId,
        kind: plan.event.kind,
        actorUserId,
        body: plan.event.body ?? null,
        meta: plan.event.meta ?? null,
      })

      return { ok: true as const }
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed'
    logger.error('barrier lifecycle write failed', {
      barrierId,
      error: message,
    })
    return { ok: false, error: message }
  }
}

/** Assign a barrier to a user, optionally with a due time. */
export async function assignBarrierAction(
  barrierId: string,
  ownerUserId: string,
  dueAt?: Date | null,
): Promise<LifecycleResult> {
  const actor = await currentUserId()
  if (!actor) return { ok: false, error: 'Unauthorized' }
  if (!ownerUserId)
    return { ok: false, error: 'Choose someone to assign this to.' }

  const result = await mutateBarrier(barrierId, actor, (barrier) => {
    if (!isOpen(barrier.status)) {
      return { error: `This barrier is already ${barrier.status}.` }
    }
    return {
      patch: { ownerUserId, dueAt: dueAt ?? barrier.dueAt },
      event: {
        kind: 'assigned' as const,
        meta: { ownerUserId, dueAt: dueAt?.toISOString() ?? null },
      },
    }
  })

  if (result.ok) {
    revalidateBoard()
    // Fire-and-forget: a failed notification must not fail the assignment.
    void notifyBarrierAssigned(barrierId, ownerUserId)
  }
  return result
}

/** Add a progress note — "pharmacy says 4pm". */
export async function commentOnBarrierAction(
  barrierId: string,
  body: string,
): Promise<LifecycleResult> {
  const actor = await currentUserId()
  if (!actor) return { ok: false, error: 'Unauthorized' }

  const text = body.trim()
  if (!text) return { ok: false, error: 'Write something first.' }
  if (text.length > 2000)
    return { ok: false, error: 'Keep it under 2000 characters.' }

  try {
    await db.insert(barrierEvents).values({
      barrierId,
      kind: 'commented',
      actorUserId: actor,
      body: text,
    })
    revalidateBoard()
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Comment failed'
    logger.error('barrier comment failed', { barrierId, error: message })
    return { ok: false, error: message }
  }
}

/** Mark the work done. This is what finally makes the ward's count go down. */
export async function clearBarrierAction(
  barrierId: string,
  reason: string,
): Promise<LifecycleResult> {
  const actor = await currentUserId()
  if (!actor) return { ok: false, error: 'Unauthorized' }

  const text = reason.trim()
  if (!text) return { ok: false, error: 'Say how it was resolved.' }

  const result = await mutateBarrier(barrierId, actor, (barrier) => {
    if (barrier.status === 'cleared') return { error: 'Already cleared.' }
    if (barrier.status === 'dismissed') {
      return { error: 'This barrier was dismissed — reopen it first.' }
    }
    return {
      patch: {
        status: 'cleared',
        clearedAt: new Date(),
        clearedReason: text,
        clearedByUserId: actor,
      },
      event: {
        kind: 'cleared' as const,
        body: text,
        meta: { from: barrier.status, to: 'cleared' },
      },
    }
  })

  if (result.ok) {
    revalidateBoard()
    logger.info('barrier cleared', { barrierId, actor })
  }
  return result
}

/**
 * Mark a barrier as wrong. Unlike clearing, this records a **suppression** so a
 * later extraction of the same note cannot resurrect it — otherwise "the AI got
 * this wrong" would be undone by the next run.
 */
export async function dismissBarrierAction(
  barrierId: string,
  reason: string,
): Promise<LifecycleResult> {
  const actor = await currentUserId()
  if (!actor) return { ok: false, error: 'Unauthorized' }

  const text = reason.trim()
  if (!text) return { ok: false, error: 'Say why this is wrong.' }

  try {
    const result = await db.transaction(async (tx) => {
      const [barrier] = await tx
        .select()
        .from(barriers)
        .where(eq(barriers.id, barrierId))
        .for('update')

      if (!barrier) return { ok: false as const, error: 'Barrier not found' }
      if (barrier.status === 'dismissed') {
        return { ok: false as const, error: 'Already dismissed.' }
      }

      await tx
        .update(barriers)
        .set({ status: 'dismissed' })
        .where(eq(barriers.id, barrierId))

      // Only AI barriers need suppressing; a human barrier is never re-created
      // by extraction in the first place.
      if (barrier.origin === 'ai') {
        const fingerprint =
          barrier.fingerprint ||
          barrierFingerprint(barrier.type, barrier.sourceQuote)
        await tx
          .insert(barrierSuppressions)
          .values({
            encounterId: barrier.encounterId,
            sourceNoteId: barrier.sourceNoteId,
            fingerprint,
            dismissedByUserId: actor,
            reason: text,
          })
          .onConflictDoNothing()
      }

      await tx.insert(barrierEvents).values({
        barrierId,
        kind: 'dismissed',
        actorUserId: actor,
        body: text,
        meta: { from: barrier.status, to: 'dismissed' },
      })

      return { ok: true as const }
    })

    if (result.ok) revalidateBoard()
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dismiss failed'
    logger.error('barrier dismiss failed', { barrierId, error: message })
    return { ok: false, error: message }
  }
}

/**
 * Undo a clear or a dismissal. Reopening also lifts the suppression, so the
 * next extraction may legitimately re-confirm the barrier.
 */
export async function reopenBarrierAction(
  barrierId: string,
  reason: string,
): Promise<LifecycleResult> {
  const actor = await currentUserId()
  if (!actor) return { ok: false, error: 'Unauthorized' }

  const text = reason.trim()
  if (!text) return { ok: false, error: 'Say why you are reopening it.' }

  try {
    const result = await db.transaction(async (tx) => {
      const [barrier] = await tx
        .select()
        .from(barriers)
        .where(eq(barriers.id, barrierId))
        .for('update')

      if (!barrier) return { ok: false as const, error: 'Barrier not found' }
      if (isOpen(barrier.status)) {
        return { ok: false as const, error: 'This barrier is already open.' }
      }

      await tx
        .update(barriers)
        .set({
          status: 'pending',
          clearedAt: null,
          clearedReason: null,
          clearedByUserId: null,
        })
        .where(eq(barriers.id, barrierId))

      if (barrier.status === 'dismissed' && barrier.fingerprint) {
        await tx
          .delete(barrierSuppressions)
          .where(
            and(
              eq(barrierSuppressions.sourceNoteId, barrier.sourceNoteId),
              eq(barrierSuppressions.fingerprint, barrier.fingerprint),
            ),
          )
      }

      await tx.insert(barrierEvents).values({
        barrierId,
        kind: 'reopened',
        actorUserId: actor,
        body: text,
        meta: { from: barrier.status, to: 'pending' },
      })

      return { ok: true as const }
    })

    if (result.ok) revalidateBoard()
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reopen failed'
    logger.error('barrier reopen failed', { barrierId, error: message })
    return { ok: false, error: message }
  }
}

/**
 * Raise a barrier the extraction missed. Stored with `origin: 'human'`, which
 * makes it invisible to reconcile — a clinician's barrier is never touched by a
 * model re-run.
 */
export async function createBarrierAction(input: {
  encounterId: string
  type: BarrierType
  description: string
  ownerUserId?: string | null
  dueAt?: Date | null
}): Promise<LifecycleResult> {
  const actor = await currentUserId()
  if (!actor) return { ok: false, error: 'Unauthorized' }

  const description = input.description.trim()
  if (!description) return { ok: false, error: 'Describe the barrier.' }
  if (description.length > 1000) {
    return { ok: false, error: 'Keep it under 1000 characters.' }
  }

  try {
    const result = await db.transaction(async (tx) => {
      // A human barrier still needs a note to hang off — the schema requires
      // provenance on every barrier — so attribute it to the encounter's most
      // recent note. The description, not a quote, is the actual record.
      const [latestNote] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(eq(notes.encounterId, input.encounterId))
        .orderBy(desc(notes.writtenAt))
        .limit(1)

      if (!latestNote) {
        return {
          ok: false as const,
          error:
            'This patient has no notes yet, so a barrier cannot be attributed.',
        }
      }

      const [created] = await tx
        .insert(barriers)
        .values({
          encounterId: input.encounterId,
          sourceNoteId: latestNote.id,
          type: input.type,
          status: 'pending',
          origin: 'human',
          createdByUserId: actor,
          description,
          // Human barriers carry no model quote; the description is the record.
          sourceQuote: '',
          confidence: null,
          ownerUserId: input.ownerUserId ?? null,
          dueAt: input.dueAt ?? null,
          firstSeenAt: new Date(),
          fingerprint: `human:${crypto.randomUUID()}`,
        })
        .returning({ id: barriers.id })

      await tx.insert(barrierEvents).values({
        barrierId: created!.id,
        kind: 'created',
        actorUserId: actor,
        body: description,
        meta: { origin: 'human' },
      })

      return { ok: true as const, id: created!.id }
    })

    if (result.ok) {
      revalidateBoard()
      if (input.ownerUserId)
        void notifyBarrierAssigned(result.id, input.ownerUserId)
      return { ok: true }
    }
    return result
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Could not add the barrier'
    logger.error('barrier create failed', { error: message })
    return { ok: false, error: message }
  }
}
