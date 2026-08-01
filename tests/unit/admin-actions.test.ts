import { beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted so the vi.mock factories below can safely reference them.
const { mockEnv, dbMock } = vi.hoisted(() => ({
  mockEnv: {} as Record<string, unknown>,
  dbMock: {
    query: {
      users: { findFirst: vi.fn(), findMany: vi.fn() },
      roles: { findFirst: vi.fn(), findMany: vi.fn() },
      wards: { findMany: vi.fn() },
    },
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGetSession = vi.fn()
vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: () => mockGetSession(),
}))

vi.mock('@/lib/env', () => ({ env: mockEnv }))

vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

const mockIsEmailEnabled = vi.fn()
const mockSendEmail = vi.fn()
vi.mock('@/lib/email', () => ({
  isEmailEnabled: () => mockIsEmailEnabled(),
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}))
vi.mock('@/lib/email/templates', () => ({
  inviteEmail: vi.fn(() => ({
    to: 'x',
    subject: 'x',
    text: 'x',
    html: 'x',
  })),
}))

const mockHashPassword = vi.fn()
vi.mock('@/lib/auth/password', () => ({
  hashPassword: (...args: unknown[]) => mockHashPassword(...args),
}))

const mockDeleteAllFilesForUser = vi.fn()
vi.mock('@/lib/storage/actions', () => ({
  deleteAllFilesForUser: (...args: unknown[]) =>
    mockDeleteAllFilesForUser(...args),
}))

vi.mock('@/db', () => ({ db: dbMock }))

import { ForbiddenError } from '@/lib/auth/rbac'
import { resetRateLimit } from '@/lib/rate-limit'
import {
  assignRoles,
  assignWards,
  canCompleteRegistration,
  completeRegistration,
  createUser,
  deleteUser,
  getAllRoles,
  getAllUsersWithRoles,
  getAllWards,
  updateUser,
} from '@/lib/auth/admin-actions'

// --- fixtures ---------------------------------------------------------------

// Valid RFC4122 v4-shaped UUIDs (zod's `.uuid()` checks the version/variant nibbles).
const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111'
const MEMBER_USER_ID = '22222222-2222-4222-8222-222222222222'
const NEW_USER_ID = '33333333-3333-4333-8333-333333333333'
const ADMIN_ROLE_ID = '44444444-4444-4444-8444-444444444444'
const MEMBER_ROLE_ID = '55555555-5555-4555-8555-555555555555'

const adminSession = { user: { id: ADMIN_USER_ID, roles: ['admin'] } }
const memberSession = { user: { id: MEMBER_USER_ID, roles: ['member'] } }

const memberRoleRow = {
  id: MEMBER_ROLE_ID,
  name: 'member',
  description: null,
}
const adminRoleRow = { id: ADMIN_ROLE_ID, name: 'admin', description: null }

/** A user row shaped the way `db.query.users.findFirst/findMany` return it. */
function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: NEW_USER_ID,
    name: 'New User',
    email: 'new@example.com',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    hashedPassword: null,
    userRoles: [{ role: memberRoleRow }],
    ...overrides,
  }
}

/** `db.insert(table).values(...)` chain — awaitable directly, or via `.returning()`. */
function insertChain(returningValue: unknown[] = []) {
  const chain = Object.assign(Promise.resolve(undefined), {
    returning: vi.fn().mockResolvedValue(returningValue),
  })
  return { values: vi.fn().mockReturnValue(chain) }
}

/** `db.update(table).set(...).where(...)` chain. */
function updateChain() {
  return {
    set: vi
      .fn()
      .mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  }
}

/** `db.delete(table).where(...)` chain. */
function deleteChain() {
  return { where: vi.fn().mockResolvedValue(undefined) }
}

beforeEach(() => {
  mockGetSession.mockReset()
  for (const key of Object.keys(mockEnv)) delete mockEnv[key]

  dbMock.query.users.findFirst.mockReset()
  dbMock.query.users.findMany.mockReset()
  dbMock.query.roles.findFirst.mockReset()
  dbMock.query.roles.findMany.mockReset()
  dbMock.query.wards.findMany.mockReset()
  dbMock.insert.mockReset()
  dbMock.update.mockReset().mockReturnValue(updateChain())
  dbMock.delete.mockReset().mockReturnValue(deleteChain())

  mockIsEmailEnabled.mockReset().mockReturnValue(false)
  mockSendEmail.mockReset().mockResolvedValue({ sent: false, skipped: true })
  mockHashPassword.mockReset().mockResolvedValue('hashed')
  mockDeleteAllFilesForUser.mockReset().mockResolvedValue(undefined)

  resetRateLimit()
})

// --- getAllUsersWithRoles / getAllRoles -------------------------------------

describe('getAllUsersWithRoles', () => {
  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(getAllUsersWithRoles()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns users mapped with roles and hasPassword', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findMany.mockResolvedValue([
      userRow({ hashedPassword: 'x' }),
      userRow({ id: ADMIN_USER_ID, userRoles: [{ role: adminRoleRow }] }),
    ])

    const result = await getAllUsersWithRoles()

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      id: NEW_USER_ID,
      hasPassword: true,
      roles: [memberRoleRow],
    })
    expect(result[1]).toMatchObject({
      hasPassword: false,
      roles: [adminRoleRow],
    })
  })
})

describe('getAllRoles', () => {
  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(getAllRoles()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns all roles for an admin', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.roles.findMany.mockResolvedValue([adminRoleRow, memberRoleRow])
    await expect(getAllRoles()).resolves.toEqual([adminRoleRow, memberRoleRow])
  })
})

// --- createUser --------------------------------------------------------------

describe('createUser', () => {
  const input = {
    name: 'New User',
    email: 'new@example.com',
    roleIds: [MEMBER_ROLE_ID],
  }

  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(createUser(input)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('rejects invalid input', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    await expect(
      createUser({ name: '', email: 'not-an-email', roleIds: [] }),
    ).rejects.toThrow()
  })

  it('rejects a duplicate email', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: 'existing' })

    await expect(createUser(input)).rejects.toThrow(
      'An account with this email already exists.',
    )
  })

  it('rejects unknown role ids', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce(null) // no duplicate
    dbMock.query.roles.findMany.mockResolvedValueOnce([]) // none match

    await expect(createUser(input)).rejects.toThrow(
      'One or more roles do not exist.',
    )
  })

  it('creates the user and returns an invite token when email is disabled', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst
      .mockResolvedValueOnce(null) // duplicate check
      .mockResolvedValueOnce(userRow()) // final fetch with roles
    dbMock.query.roles.findMany.mockResolvedValueOnce([memberRoleRow])
    dbMock.insert
      .mockReturnValueOnce(insertChain([{ id: NEW_USER_ID }])) // users insert
      .mockReturnValueOnce(insertChain()) // userRoles insert
    mockIsEmailEnabled.mockReturnValue(false)

    const result = await createUser(input)

    expect(result).toMatchObject({
      id: NEW_USER_ID,
      hasPassword: false,
      emailSent: false,
      roles: [memberRoleRow],
    })
    expect(result.inviteToken).toEqual(expect.any(String))
    expect(result.inviteToken.length).toBeGreaterThan(0)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('emails the invite link when email is enabled and reports emailSent', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(userRow())
    dbMock.query.roles.findMany.mockResolvedValueOnce([memberRoleRow])
    dbMock.insert
      .mockReturnValueOnce(insertChain([{ id: NEW_USER_ID }]))
      .mockReturnValueOnce(insertChain())
    mockIsEmailEnabled.mockReturnValue(true)
    mockSendEmail.mockResolvedValue({ sent: true })

    const result = await createUser(input)

    expect(result.emailSent).toBe(true)
    expect(mockSendEmail).toHaveBeenCalledOnce()
  })
})

// --- updateUser ----------------------------------------------------------------

describe('updateUser', () => {
  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(updateUser(NEW_USER_ID, { name: 'X' })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('errors when the target user does not exist', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce(null)

    await expect(updateUser(NEW_USER_ID, { name: 'X' })).rejects.toThrow(
      'User not found.',
    )
  })

  it('rejects an email change to an address already in use', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst
      .mockResolvedValueOnce(userRow()) // target
      .mockResolvedValueOnce({ id: 'someone-else' }) // uniqueness check

    await expect(
      updateUser(NEW_USER_ID, { email: 'taken@example.com' }),
    ).rejects.toThrow('An account with this email already exists.')
  })

  it('prevents an admin from removing their own admin role', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce(
      userRow({ id: ADMIN_USER_ID, userRoles: [{ role: adminRoleRow }] }),
    )
    dbMock.query.roles.findMany.mockResolvedValueOnce([memberRoleRow])
    dbMock.query.roles.findFirst.mockResolvedValueOnce(adminRoleRow)

    await expect(
      updateUser(ADMIN_USER_ID, { roleIds: [MEMBER_ROLE_ID] }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('updates name and roles for another user', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst
      .mockResolvedValueOnce(userRow({ id: MEMBER_USER_ID })) // target
      .mockResolvedValueOnce(userRow({ id: MEMBER_USER_ID, name: 'Renamed' })) // final fetch
    dbMock.query.roles.findMany.mockResolvedValueOnce([memberRoleRow])
    dbMock.insert.mockReturnValueOnce(insertChain())

    const result = await updateUser(MEMBER_USER_ID, {
      name: 'Renamed',
      roleIds: [MEMBER_ROLE_ID],
    })

    expect(result.name).toBe('Renamed')
    expect(dbMock.update).toHaveBeenCalled()
    expect(dbMock.delete).toHaveBeenCalled() // replaces userRoles
  })
})

// --- deleteUser ------------------------------------------------------------

describe('deleteUser', () => {
  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(deleteUser(NEW_USER_ID)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('prevents an admin from deleting their own account', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    await expect(deleteUser(ADMIN_USER_ID)).rejects.toBeInstanceOf(
      ForbiddenError,
    )
  })

  it('errors when the target user does not exist', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce(null)

    await expect(deleteUser(MEMBER_USER_ID)).rejects.toThrow('User not found.')
  })

  it('deletes an existing target user', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: MEMBER_USER_ID })

    await expect(deleteUser(MEMBER_USER_ID)).resolves.toBeUndefined()
    expect(dbMock.delete).toHaveBeenCalled()
    // S3 objects must be removed before the user row (and its files rows)
    // cascade-delete — otherwise the bucket keys are lost.
    expect(mockDeleteAllFilesForUser).toHaveBeenCalledWith(MEMBER_USER_ID)
  })
})

// --- assignRoles -------------------------------------------------------------

describe('assignRoles', () => {
  const input = { userId: MEMBER_USER_ID, roleIds: [MEMBER_ROLE_ID] }

  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(assignRoles(input)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('errors when the target user does not exist', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce(null)

    await expect(assignRoles(input)).rejects.toThrow('User not found.')
  })

  it('rejects unknown role ids', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: MEMBER_USER_ID })
    dbMock.query.roles.findMany.mockResolvedValueOnce([])

    await expect(assignRoles(input)).rejects.toThrow(
      'One or more roles do not exist.',
    )
  })

  it('prevents an admin from removing their own admin role', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: ADMIN_USER_ID })
    dbMock.query.roles.findMany.mockResolvedValueOnce([memberRoleRow])
    dbMock.query.roles.findFirst.mockResolvedValueOnce(adminRoleRow)

    await expect(
      assignRoles({ userId: ADMIN_USER_ID, roleIds: [MEMBER_ROLE_ID] }),
    ).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('replaces roles for another user', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: MEMBER_USER_ID })
    dbMock.query.roles.findMany.mockResolvedValueOnce([memberRoleRow])
    dbMock.insert.mockReturnValueOnce(insertChain())

    await expect(assignRoles(input)).resolves.toBeUndefined()
    expect(dbMock.delete).toHaveBeenCalled()
    expect(dbMock.insert).toHaveBeenCalled()
  })
})

// --- getAllWards / assignWards (spec v0.12.0 FR2) ----------------------------

const WARD_A_ID = '66666666-6666-4666-8666-666666666666'
const WARD_B_ID = '77777777-7777-4777-8777-777777777777'

describe('getAllWards', () => {
  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(getAllWards()).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('returns id and name for every ward', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.wards.findMany.mockResolvedValue([
      { id: WARD_A_ID, name: 'Ward A', createdAt: new Date() },
    ])
    await expect(getAllWards()).resolves.toEqual([
      { id: WARD_A_ID, name: 'Ward A' },
    ])
  })
})

describe('assignWards', () => {
  const input = { userId: MEMBER_USER_ID, wardIds: [WARD_A_ID] }

  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(memberSession)
    await expect(assignWards(input)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('errors when the target user does not exist', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce(null)
    await expect(assignWards(input)).rejects.toThrow('User not found.')
  })

  it('rejects unknown ward ids', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: MEMBER_USER_ID })
    dbMock.query.wards.findMany.mockResolvedValueOnce([])
    await expect(assignWards(input)).rejects.toThrow(
      'One or more wards do not exist.',
    )
  })

  it('replaces memberships for a user', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: MEMBER_USER_ID })
    dbMock.query.wards.findMany.mockResolvedValueOnce([
      { id: WARD_A_ID },
      { id: WARD_B_ID },
    ])
    dbMock.insert.mockReturnValueOnce(insertChain())

    await expect(
      assignWards({ userId: MEMBER_USER_ID, wardIds: [WARD_A_ID, WARD_B_ID] }),
    ).resolves.toBeUndefined()
    expect(dbMock.delete).toHaveBeenCalled()
    expect(dbMock.insert).toHaveBeenCalled()
  })

  it('accepts an empty ward list (removes the user from every ward)', async () => {
    mockGetSession.mockResolvedValue(adminSession)
    dbMock.query.users.findFirst.mockResolvedValueOnce({ id: MEMBER_USER_ID })

    await expect(
      assignWards({ userId: MEMBER_USER_ID, wardIds: [] }),
    ).resolves.toBeUndefined()
    expect(dbMock.delete).toHaveBeenCalled()
    expect(dbMock.insert).not.toHaveBeenCalled()
    // No existence check needed when clearing memberships.
    expect(dbMock.query.wards.findMany).not.toHaveBeenCalled()
  })
})

// --- canCompleteRegistration / completeRegistration ---------------------------

describe('canCompleteRegistration', () => {
  it('is true for an invited (passwordless) account', async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: NEW_USER_ID,
      hashedPassword: null,
    })
    await expect(canCompleteRegistration('new@example.com')).resolves.toBe(true)
  })

  it('is false when no account exists', async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null)
    await expect(canCompleteRegistration('nobody@example.com')).resolves.toBe(
      false,
    )
  })

  it('is false when the account already has a password', async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: NEW_USER_ID,
      hashedPassword: 'x',
    })
    await expect(canCompleteRegistration('new@example.com')).resolves.toBe(
      false,
    )
  })
})

describe('completeRegistration', () => {
  it('errors when the account does not exist', async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce(null)
    await expect(
      completeRegistration('nobody@example.com', 'Password123'),
    ).rejects.toThrow('Account not found.')
  })

  it('errors when the account already has a password', async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: NEW_USER_ID,
      hashedPassword: 'x',
    })
    await expect(
      completeRegistration('new@example.com', 'Password123'),
    ).rejects.toThrow('Account already has a password. Please sign in.')
  })

  it('hashes and sets the password for an invited account', async () => {
    dbMock.query.users.findFirst.mockResolvedValueOnce({
      id: NEW_USER_ID,
      hashedPassword: null,
    })

    await completeRegistration('new@example.com', 'Password123')

    expect(mockHashPassword).toHaveBeenCalledWith('Password123')
    expect(dbMock.update).toHaveBeenCalled()
  })
})
