import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so the vi.mock factories below can safely reference them.
const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    query: {
      userWards: { findMany: vi.fn() },
      encounters: { findFirst: vi.fn() },
      wards: { findFirst: vi.fn() },
    },
  },
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: () => mockGetSession(),
}))

vi.mock('@/db', () => ({ db: dbMock }))

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import {
  CAPABILITY_MATRIX,
  WARD_CAPABILITIES,
  WARD_ROLES,
  requireWardAccess,
  type WardCapability,
  type WardRole,
} from '@/lib/auth/ward-access'

const USER_ID = 'u1'
const WARD_A = 'ward-a'
const WARD_B = 'ward-b'

const session = (roles?: string[]) =>
  roles ? { user: { id: USER_ID, roles } } : null

/** Make the user a member of the given wards and let ward lookups succeed. */
function memberOf(...wardIds: string[]) {
  dbMock.query.userWards.findMany.mockResolvedValue(
    wardIds.map((wardId) => ({ wardId })),
  )
}

beforeEach(() => {
  mockGetSession.mockReset()
  dbMock.query.userWards.findMany.mockReset().mockResolvedValue([])
  dbMock.query.encounters.findFirst.mockReset().mockResolvedValue(undefined)
  // Ward existence lookup (admin + wardId scope) succeeds by default.
  dbMock.query.wards.findFirst
    .mockReset()
    .mockImplementation(async ({ where: _where }: { where: unknown }) => ({
      id: WARD_A,
    }))
})

/* -------------------------------------------------------------------------- */
/* The capability matrix, exhaustively. THE TEST DATA BELOW IS THE MATRIX —    */
/* it restates the spec table (spec v0.12.0 "Interfaces & contracts").         */
/* A capability or role added to ward-access.ts without an entry here fails    */
/* both the type-check and the completeness assertions.                        */
/* -------------------------------------------------------------------------- */

const EXPECTED: Record<WardCapability, Record<WardRole, boolean>> = {
  view_board: {
    admin: true,
    bed_manager: true,
    charge_nurse: true,
    clinician: true,
    allied_health: true,
    viewer: true,
  },
  ask_copilot: {
    admin: true,
    bed_manager: true,
    charge_nurse: true,
    clinician: true,
    allied_health: true,
    viewer: true,
  },
  assign_comment: {
    admin: true,
    bed_manager: true,
    charge_nurse: true,
    clinician: true,
    allied_health: true,
    viewer: false,
  },
  clear_dismiss_barrier: {
    admin: true,
    bed_manager: true,
    charge_nurse: true,
    clinician: true,
    allied_health: true,
    viewer: false,
  },
  create_manual_barrier: {
    admin: true,
    bed_manager: true,
    charge_nurse: true,
    clinician: true,
    allied_health: true,
    viewer: false,
  },
  override_edd: {
    admin: true,
    bed_manager: true,
    charge_nurse: true,
    clinician: true,
    allied_health: false,
    viewer: false,
  },
  approve_recommendation: {
    admin: true,
    bed_manager: true,
    charge_nurse: true,
    clinician: true,
    allied_health: false,
    viewer: false,
  },
  run_extraction: {
    admin: true,
    bed_manager: true,
    charge_nurse: false,
    clinician: false,
    allied_health: false,
    viewer: false,
  },
  generate_recommendations: {
    admin: true,
    bed_manager: true,
    charge_nurse: false,
    clinician: false,
    allied_health: false,
    viewer: false,
  },
  view_access_audit: {
    admin: true,
    bed_manager: false,
    charge_nurse: false,
    clinician: false,
    allied_health: false,
    viewer: false,
  },
}

describe('capability matrix — completeness', () => {
  it('has a row for every capability and a column for every role', () => {
    expect(Object.keys(CAPABILITY_MATRIX).sort()).toEqual(
      [...WARD_CAPABILITIES].sort(),
    )
    for (const capability of WARD_CAPABILITIES) {
      expect(Object.keys(CAPABILITY_MATRIX[capability]).sort()).toEqual(
        [...WARD_ROLES].sort(),
      )
    }
  })

  it('matches the expected table exactly', () => {
    expect(CAPABILITY_MATRIX).toEqual(EXPECTED)
  })
})

describe('capability matrix — every (role × capability) pair via requireWardAccess', () => {
  for (const role of WARD_ROLES) {
    for (const capability of WARD_CAPABILITIES) {
      const allowed = EXPECTED[capability][role]
      it(`${role} ${allowed ? 'can' : 'cannot'} ${capability} in a ward they belong to`, async () => {
        mockGetSession.mockResolvedValue(session([role]))
        memberOf(WARD_A)

        const result = await requireWardAccess(capability, { wardId: WARD_A })

        expect(result.ok).toBe(allowed)
        if (result.ok) {
          expect(result).toMatchObject({ userId: USER_ID, wardId: WARD_A })
        } else {
          expect(result.error).toBeTruthy()
        }
      })
    }
  }
})

/* -------------------------------------------------------------------------- */
/* Fail closed (spec NFR1)                                                     */
/* -------------------------------------------------------------------------- */

describe('requireWardAccess — fails closed', () => {
  it('denies without a session', async () => {
    mockGetSession.mockResolvedValue(null)
    const result = await requireWardAccess('view_board', { wardId: WARD_A })
    expect(result.ok).toBe(false)
  })

  it('denies a session with no roles', async () => {
    mockGetSession.mockResolvedValue(session([]))
    memberOf(WARD_A)
    const result = await requireWardAccess('view_board', { wardId: WARD_A })
    expect(result.ok).toBe(false)
  })

  it('denies a session whose roles are undefined', async () => {
    mockGetSession.mockResolvedValue({ user: { id: USER_ID } })
    memberOf(WARD_A)
    const result = await requireWardAccess('view_board', { wardId: WARD_A })
    expect(result.ok).toBe(false)
  })

  it('denies a role the matrix does not know (legacy `member` grants nothing)', async () => {
    mockGetSession.mockResolvedValue(session(['member']))
    memberOf(WARD_A)
    const result = await requireWardAccess('view_board', { wardId: WARD_A })
    expect(result.ok).toBe(false)
  })

  it('denies a capability missing from the matrix', async () => {
    mockGetSession.mockResolvedValue(session(['admin']))
    const result = await requireWardAccess(
      'not_a_capability' as WardCapability,
      { any: true },
    )
    expect(result.ok).toBe(false)
  })

  it('denies a user with NO ward membership even when the role allows the capability', async () => {
    mockGetSession.mockResolvedValue(session(['bed_manager']))
    memberOf(/* nothing */)
    const result = await requireWardAccess('view_board', { wardId: WARD_A })
    expect(result.ok).toBe(false)
  })

  it('denies a user with NO ward membership for `any` scope too', async () => {
    mockGetSession.mockResolvedValue(session(['bed_manager']))
    memberOf(/* nothing */)
    const result = await requireWardAccess('view_board', { any: true })
    expect(result.ok).toBe(false)
  })

  it('denies membership of a different ward', async () => {
    mockGetSession.mockResolvedValue(session(['bed_manager']))
    memberOf(WARD_B)
    const result = await requireWardAccess('view_board', { wardId: WARD_A })
    expect(result.ok).toBe(false)
  })

  it('denies an unknown encounter', async () => {
    mockGetSession.mockResolvedValue(session(['bed_manager']))
    memberOf(WARD_A)
    dbMock.query.encounters.findFirst.mockResolvedValue(undefined)
    const result = await requireWardAccess('view_board', {
      encounterId: 'nope',
    })
    expect(result.ok).toBe(false)
  })

  it('denies an encounter with no bed (no resolvable ward)', async () => {
    mockGetSession.mockResolvedValue(session(['bed_manager']))
    memberOf(WARD_A)
    dbMock.query.encounters.findFirst.mockResolvedValue({ id: 'e1', bed: null })
    const result = await requireWardAccess('view_board', { encounterId: 'e1' })
    expect(result.ok).toBe(false)
  })

  it('denies an empty ward id and an empty encounter id', async () => {
    mockGetSession.mockResolvedValue(session(['bed_manager']))
    memberOf(WARD_A)
    expect((await requireWardAccess('view_board', { wardId: '' })).ok).toBe(
      false,
    )
    expect(
      (await requireWardAccess('view_board', { encounterId: '' })).ok,
    ).toBe(false)
  })

  it('denies an admin a ward that does not exist', async () => {
    mockGetSession.mockResolvedValue(session(['admin']))
    dbMock.query.wards.findFirst.mockResolvedValue(undefined)
    const result = await requireWardAccess('view_board', { wardId: 'ghost' })
    expect(result.ok).toBe(false)
  })
})

/* -------------------------------------------------------------------------- */
/* Resolution behaviour                                                        */
/* -------------------------------------------------------------------------- */

describe('requireWardAccess — resolution', () => {
  it('resolves an encounter to its ward and grants a member', async () => {
    mockGetSession.mockResolvedValue(session(['clinician']))
    memberOf(WARD_A)
    dbMock.query.encounters.findFirst.mockResolvedValue({
      id: 'e1',
      bed: { wardId: WARD_A },
    })

    const result = await requireWardAccess('assign_comment', {
      encounterId: 'e1',
    })

    expect(result).toMatchObject({ ok: true, userId: USER_ID, wardId: WARD_A })
  })

  it('denies a member of a different ward for an encounter-scoped action', async () => {
    mockGetSession.mockResolvedValue(session(['clinician']))
    memberOf(WARD_B)
    dbMock.query.encounters.findFirst.mockResolvedValue({
      id: 'e1',
      bed: { wardId: WARD_A },
    })

    const result = await requireWardAccess('assign_comment', {
      encounterId: 'e1',
    })

    expect(result.ok).toBe(false)
  })

  it('resolves ward membership exactly once per call (NFR5)', async () => {
    mockGetSession.mockResolvedValue(session(['clinician']))
    memberOf(WARD_A)
    dbMock.query.encounters.findFirst.mockResolvedValue({
      id: 'e1',
      bed: { wardId: WARD_A },
    })

    await requireWardAccess('assign_comment', { encounterId: 'e1' })

    expect(dbMock.query.userWards.findMany).toHaveBeenCalledTimes(1)
  })

  it('grants `any` scope to a member of at least one ward, with a null wardId', async () => {
    mockGetSession.mockResolvedValue(session(['viewer']))
    memberOf(WARD_B)

    const result = await requireWardAccess('view_board', { any: true })

    expect(result).toMatchObject({ ok: true, userId: USER_ID, wardId: null })
  })

  it('admin passes every capability without any ward membership', async () => {
    mockGetSession.mockResolvedValue(session(['admin']))
    memberOf(/* nothing */)

    for (const capability of WARD_CAPABILITIES) {
      const result = await requireWardAccess(capability, { wardId: WARD_A })
      expect(result).toMatchObject({
        ok: true,
        userId: USER_ID,
        wardId: WARD_A,
      })
    }
    // Admin never even consults the membership table.
    expect(dbMock.query.userWards.findMany).not.toHaveBeenCalled()
  })

  it('a second, recognised role grants what the first cannot (role union)', async () => {
    mockGetSession.mockResolvedValue(session(['viewer', 'bed_manager']))
    memberOf(WARD_A)

    const result = await requireWardAccess('run_extraction', {
      wardId: WARD_A,
    })

    expect(result.ok).toBe(true)
  })
})
