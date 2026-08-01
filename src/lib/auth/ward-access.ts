import 'server-only'

import { eq } from 'drizzle-orm'

import { db } from '@/db'
import { encounters, userWards, wards } from '@/db/schema'
import { getCurrentSession } from '@/lib/auth/session'
import { logger } from '@/lib/logger'

/**
 * Ward authorization (spec v0.12.0 M2).
 *
 * One helper — `requireWardAccess` — that every ward-surface server action and
 * query calls before doing anything. Authorization lives in this file so a
 * missing check is a visible omission, not an invisible default.
 *
 * Design rules (spec NFR1/NFR2/NFR5):
 * - **Fails closed.** No session, no roles, an unknown role, no ward
 *   membership, an unknown encounter or an unknown ward all DENY. No code path
 *   treats an unresolvable role or ward as permissive.
 * - **Expected denials return `{ ok: false, error }`, never throw** — Next.js
 *   redacts thrown messages in production (see CLAUDE.md).
 * - **Membership is resolved once per call**, never per row.
 */

/** Everything a user can do on the ward surface. */
export const WARD_CAPABILITIES = [
  'view_board',
  'ask_copilot',
  'assign_comment',
  'clear_dismiss_barrier',
  'create_manual_barrier',
  'override_edd',
  'approve_recommendation',
  'run_extraction',
  'generate_recommendations',
  'view_access_audit',
] as const
export type WardCapability = (typeof WARD_CAPABILITIES)[number]

/**
 * Roles the ward surface understands. The legacy `member` role is deliberately
 * absent: it has no clinical meaning, so it grants nothing here (migration 0015
 * granted every pre-v0.12.0 non-admin user `bed_manager`, the de-facto
 * capability they already had, so nobody lost access on upgrade).
 */
export const WARD_ROLES = [
  'admin',
  'bed_manager',
  'charge_nurse',
  'clinician',
  'allied_health',
  'viewer',
] as const
export type WardRole = (typeof WARD_ROLES)[number]

/**
 * The capability matrix — the whole authorization policy as data, one row per
 * capability (spec v0.12.0 "Interfaces & contracts").
 *
 * PROVISIONAL: this is a reasonable first cut, NOT a clinical governance
 * decision. It should be reviewed by someone who runs a ward before it is
 * called correct. It is data in one file — cheap to change.
 */
// Row builder keeps each matrix line to one row per capability in the order
// admin, bed_manager, charge_nurse, clinician, allied_health, viewer — so the
// code reads like the table in the spec.
const row = (
  admin: boolean,
  bedManager: boolean,
  chargeNurse: boolean,
  clinician: boolean,
  alliedHealth: boolean,
  viewer: boolean,
): Record<WardRole, boolean> => ({
  admin,
  bed_manager: bedManager,
  charge_nurse: chargeNurse,
  clinician,
  allied_health: alliedHealth,
  viewer,
})

export const CAPABILITY_MATRIX: Record<
  WardCapability,
  Record<WardRole, boolean>
> = {
  //                              admin  bed_mg charge clinic allied viewer
  view_board: /*              */ row(true, true, true, true, true, true),
  ask_copilot: /*             */ row(true, true, true, true, true, true),
  assign_comment: /*          */ row(true, true, true, true, true, false),
  clear_dismiss_barrier: /*   */ row(true, true, true, true, true, false),
  create_manual_barrier: /*   */ row(true, true, true, true, true, false),
  override_edd: /*            */ row(true, true, true, true, false, false),
  approve_recommendation: /*  */ row(true, true, true, true, false, false),
  run_extraction: /*          */ row(true, true, false, false, false, false),
  generate_recommendations: /**/ row(true, true, false, false, false, false),
  view_access_audit: /*       */ row(true, false, false, false, false, false),
}

/**
 * What the check is scoped to:
 * - `{ encounterId }` — a patient-scoped action; the encounter's current ward
 *   is resolved server-side and membership of it is required.
 * - `{ wardId }`     — a ward-scoped action (e.g. run extraction for a ward).
 * - `{ any: true }`  — not tied to one ward; a non-admin still needs at least
 *   one ward membership (a user assigned to no ward sees no patient data at
 *   all — spec acceptance criteria).
 */
export type WardScope =
  { encounterId: string } | { wardId: string } | { any: true }

export type WardAccessResult =
  | {
      ok: true
      userId: string
      /** The resolved ward, or null for `{ any: true }` scope. */
      wardId: string | null
    }
  | { ok: false; error: string }

const DENIED_ERROR = 'You do not have permission to do this.'
const DENIED_WARD_ERROR = 'You do not have access to this ward.'

function isWardRole(role: string): role is WardRole {
  return (WARD_ROLES as readonly string[]).includes(role)
}

/**
 * Authorize the current user for `capability` within `scope`.
 *
 * Resolves the session, the user's roles and (at most once) their ward
 * memberships. Returns the resolved context or a refusal; never throws for an
 * expected denial. `admin` passes every capability and is exempt from ward
 * membership, but a ward/encounter that cannot be resolved still denies —
 * fail closed applies to admins too.
 */
export async function requireWardAccess(
  capability: WardCapability,
  scope: WardScope,
): Promise<WardAccessResult> {
  const session = await getCurrentSession()
  const userId = session?.user?.id
  if (!userId) {
    return deny(capability, scope, undefined, 'no session', 'Not signed in.')
  }

  // Unknown role names (e.g. legacy `member`) are ignored, not permissive.
  const roles = (session.user.roles ?? []).filter(isWardRole)
  if (roles.length === 0) {
    return deny(capability, scope, userId, 'no recognised roles')
  }

  const row = CAPABILITY_MATRIX[capability] as
    Record<WardRole, boolean> | undefined
  // A capability missing from the matrix denies for everyone (fail closed —
  // reachable only from untyped call sites, but the default must be "no").
  if (!row) {
    return deny(capability, scope, userId, 'capability not in matrix')
  }
  if (!roles.some((role) => row[role])) {
    return deny(capability, scope, userId, 'role lacks capability')
  }

  const isAdmin = roles.includes('admin')

  // Resolve the target ward from the scope. Anything unresolvable denies.
  let targetWardId: string | null = null
  if ('encounterId' in scope) {
    if (!scope.encounterId) {
      return deny(capability, scope, userId, 'empty encounter id')
    }
    const encounter = await db.query.encounters.findFirst({
      where: eq(encounters.id, scope.encounterId),
      columns: { id: true },
      with: { bed: { columns: { wardId: true } } },
    })
    // Unknown encounter, or an encounter with no bed (discharged/unassigned),
    // resolves to no ward → deny.
    targetWardId = encounter?.bed?.wardId ?? null
    if (!targetWardId) {
      return deny(
        capability,
        scope,
        userId,
        'encounter has no resolvable ward',
        DENIED_WARD_ERROR,
      )
    }
  } else if ('wardId' in scope) {
    if (!scope.wardId) {
      return deny(capability, scope, userId, 'empty ward id')
    }
    targetWardId = scope.wardId
  }

  if (isAdmin) {
    // Admin is exempt from membership, but a named ward must still exist —
    // membership normally proves existence, so check it explicitly here.
    if (targetWardId && 'wardId' in scope) {
      const ward = await db.query.wards.findFirst({
        where: eq(wards.id, targetWardId),
        columns: { id: true },
      })
      if (!ward) {
        return deny(
          capability,
          scope,
          userId,
          'unknown ward',
          DENIED_WARD_ERROR,
        )
      }
    }
    return { ok: true, userId, wardId: targetWardId }
  }

  // Ward membership — resolved ONCE per call (spec NFR5), never per row.
  const memberships = await db.query.userWards.findMany({
    where: eq(userWards.userId, userId),
    columns: { wardId: true },
  })
  if (memberships.length === 0) {
    // No ward assignment ⇒ no patient data on any surface, whatever the role.
    return deny(
      capability,
      scope,
      userId,
      'no ward membership',
      DENIED_WARD_ERROR,
    )
  }
  if (targetWardId && !memberships.some((m) => m.wardId === targetWardId)) {
    return deny(
      capability,
      scope,
      userId,
      'not a member of target ward',
      DENIED_WARD_ERROR,
    )
  }

  return { ok: true, userId, wardId: targetWardId }
}

/** Every denial is logged at `warn` — a spike after release means the matrix is wrong. */
function deny(
  capability: WardCapability,
  scope: WardScope,
  userId: string | undefined,
  reason: string,
  error = DENIED_ERROR,
): { ok: false; error: string } {
  logger.warn('Ward access denied', {
    capability,
    scope,
    userId: userId ?? null,
    reason,
  })
  return { ok: false, error }
}
