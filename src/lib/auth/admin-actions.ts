'use server'

import { eq, inArray } from 'drizzle-orm'

import { db } from '@/db'
import { users, roles, userRoles, userWards, wards } from '@/db/schema'
import { requireRole, ForbiddenError } from '@/lib/auth/rbac'
import { requireEmailVerifiedIfEnforced } from '@/lib/auth/verification-guard'
import { createInviteToken } from '@/lib/auth/invite'
import { sendEmail, isEmailEnabled } from '@/lib/email'
import { inviteEmail } from '@/lib/email/templates'
import { env } from '@/lib/env'
import { AUTH_LIMITS, rateLimit } from '@/lib/rate-limit'
import { clientIpFromHeaders } from '@/lib/request-ip'
import { deleteAllFilesForUser } from '@/lib/storage/actions'
import { headers } from 'next/headers'
import {
  createUserSchema,
  updateUserSchema,
  assignRolesSchema,
  assignWardsSchema,
  type CreateUserInput,
  type UpdateUserInput,
  type AssignRolesInput,
  type AssignWardsInput,
} from '@/lib/validations/auth'
import { logger } from '@/lib/logger'

/** Get client IP for rate limiting. */
async function getClientIp(): Promise<string> {
  const h = await headers()
  return clientIpFromHeaders(h)
}

/** Absolute origin for building links in emails. Prefers AUTH_URL, else the request. */
async function getBaseUrl(): Promise<string> {
  if (env.AUTH_URL) return env.AUTH_URL.replace(/\/+$/, '')
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return `${proto}://${host}`
}

/** Rate limit key for admin actions. */
async function checkAdminRateLimit(action: string): Promise<void> {
  const ip = await getClientIp()
  const limited = rateLimit(
    `admin:${action}:${ip}`,
    AUTH_LIMITS.login.limit,
    AUTH_LIMITS.login.windowMs,
  )
  if (!limited.success) {
    logger.warn('Admin action rate limit exceeded', { action, ip })
    throw new Error('Too many requests. Please wait a moment.')
  }
}

/** Return type for user with roles. */
export interface UserWithRoles {
  id: string
  name: string | null
  email: string
  createdAt: Date
  roles: { id: string; name: string; description: string | null }[]
  /** Ward memberships (spec v0.12.0 FR2) — ids into `wards`. */
  wardIds: string[]
  hasPassword: boolean
}

/** createUser also returns the one-time invite token for the admin to share. */
export interface CreatedUser extends UserWithRoles {
  inviteToken: string
  /** True when the invite link was emailed (email enabled + configured + sent). */
  emailSent: boolean
}

/**
 * Get all users with their roles. Admin only.
 */
export async function getAllUsersWithRoles(): Promise<UserWithRoles[]> {
  // Read gated by requireRole('admin'); NOT rate limited — it runs on every
  // /settings render, so an auth-style limiter would lock admins out.
  await requireRole('admin')

  const allUsers = await db.query.users.findMany({
    with: {
      userRoles: {
        with: {
          role: true,
        },
      },
      userWards: true,
    },
    orderBy: (users, { desc }) => [desc(users.createdAt)],
  })

  const typedUsers = allUsers as Array<{
    id: string
    name: string | null
    email: string
    createdAt: Date
    userRoles: Array<{
      role: { id: string; name: string; description: string | null }
    }> | null
    userWards: Array<{ wardId: string }> | null
    hashedPassword: string | null
  }> | null

  return (typedUsers ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    createdAt: u.createdAt,
    roles: (u.userRoles ?? []).map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      description: ur.role.description,
    })),
    wardIds: (u.userWards ?? []).map((uw) => uw.wardId),
    hasPassword: !!u.hashedPassword,
  }))
}

/**
 * Get all available roles. Admin only.
 */
export async function getAllRoles(): Promise<
  { id: string; name: string; description: string | null }[]
> {
  await requireRole('admin')

  const allRoles = await db.query.roles.findMany({
    orderBy: (roles, { asc }) => [asc(roles.name)],
  })

  return (allRoles ?? []).map(
    (r: { id: string; name: string; description: string | null }) => ({
      id: r.id,
      name: r.name,
      description: r.description,
    }),
  )
}

/**
 * Create a new user (admin). No password — user sets it on first login.
 * Admin only.
 */
export async function createUser(input: CreateUserInput): Promise<CreatedUser> {
  await requireRole('admin')
  await requireEmailVerifiedIfEnforced()
  await checkAdminRateLimit('create-user')

  const parsed = createUserSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '))
  }

  const { name, email, roleIds } = parsed.data

  // Check email not taken
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true },
  })
  if (existing) {
    throw new Error('An account with this email already exists.')
  }

  // Verify all roleIds exist
  const validRoles = await db.query.roles.findMany({
    where: inArray(roles.id, roleIds),
    columns: { id: true },
  })
  if (validRoles.length !== roleIds.length) {
    throw new Error('One or more roles do not exist.')
  }

  // Mint an invite token; the account can only be claimed with it via /register.
  const { token, tokenHash, expires } = createInviteToken()

  const [user] = await db
    .insert(users)
    .values({
      name,
      email,
      hashedPassword: null, // No password — user sets it when they claim the invite
      inviteTokenHash: tokenHash,
      inviteExpires: expires,
    })
    .returning()

  if (!user) {
    throw new Error('Failed to create user')
  }

  // Assign roles
  await db
    .insert(userRoles)
    .values(roleIds.map((roleId) => ({ userId: user.id, roleId })))

  logger.info('Admin created user', {
    adminId: (await getCurrentSession())?.user.id,
    userId: user.id,
  })

  // Return with roles
  const withRoles = (await db.query.users.findFirst({
    where: eq(users.id, user.id),
    with: { userRoles: { with: { role: true } } },
  })) as {
    id: string
    name: string | null
    email: string
    createdAt: Date
    userRoles: Array<{
      role: { id: string; name: string; description: string | null }
    }> | null
    hashedPassword: string | null
  } | null

  if (!withRoles) {
    throw new Error('Failed to retrieve created user')
  }

  // Deliver the invite by email when email is enabled + configured. Sending is
  // best-effort: the admin always gets the copy-able link back as a fallback, so
  // a mail failure never blocks user creation.
  let emailSent = false
  if (isEmailEnabled()) {
    const baseUrl = await getBaseUrl()
    const inviteUrl = `${baseUrl}/register?invite=${encodeURIComponent(
      token,
    )}&email=${encodeURIComponent(withRoles.email)}`
    const result = await sendEmail(
      inviteEmail({ to: withRoles.email, inviteUrl }),
    )
    emailSent = result.sent
  }

  return {
    id: withRoles.id,
    name: withRoles.name,
    email: withRoles.email,
    createdAt: withRoles.createdAt,
    roles: (withRoles.userRoles ?? []).map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      description: ur.role.description,
    })),
    wardIds: [], // A freshly created user belongs to no ward until assigned.
    hasPassword: false,
    inviteToken: token,
    emailSent,
  }
}

/**
 * Update user name/email/roles (admin). Admin only.
 */
export async function updateUser(
  userId: string,
  input: UpdateUserInput,
): Promise<UserWithRoles> {
  await requireRole('admin')
  await requireEmailVerifiedIfEnforced()
  await checkAdminRateLimit('update-user')

  const parsed = updateUserSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '))
  }

  const session = await getCurrentSession()
  const currentUserId = session?.user.id

  // Prevent admin from changing their own email to a duplicate or removing own admin role
  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { userRoles: { with: { role: true } } },
  })

  if (!targetUser) {
    throw new Error('User not found.')
  }

  const { name, email, roleIds } = parsed.data

  // If email is changing, check uniqueness
  if (email && email !== targetUser.email) {
    const emailTaken = await db.query.users.findFirst({
      where: eq(users.email, email),
      columns: { id: true },
    })
    if (emailTaken) {
      throw new Error('An account with this email already exists.')
    }
  }

  // Update user
  const updateData: { name?: string; email?: string } = {}
  if (name !== undefined) updateData.name = name
  if (email !== undefined) updateData.email = email

  if (Object.keys(updateData).length > 0) {
    await db.update(users).set(updateData).where(eq(users.id, userId))
  }

  // Update roles if provided
  if (roleIds !== undefined) {
    // Verify all roles exist
    const validRoles = await db.query.roles.findMany({
      where: inArray(roles.id, roleIds),
      columns: { id: true },
    })
    if (validRoles.length !== roleIds.length) {
      throw new Error('One or more roles do not exist.')
    }

    // Prevent admin from removing own admin role
    if (userId === currentUserId) {
      const adminRole = await db.query.roles.findFirst({
        where: eq(roles.name, 'admin'),
        columns: { id: true },
      })
      if (adminRole && !roleIds.includes(adminRole.id)) {
        throw new ForbiddenError('Cannot remove your own admin role.')
      }
    }

    // Replace all roles
    await db.delete(userRoles).where(eq(userRoles.userId, userId))
    if (roleIds.length > 0) {
      await db
        .insert(userRoles)
        .values(roleIds.map((roleId) => ({ userId, roleId })))
    }
  }

  logger.info('Admin updated user', {
    adminId: currentUserId,
    targetUserId: userId,
  })

  // Return updated user
  const updated = (await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { userRoles: { with: { role: true } }, userWards: true },
  })) as {
    id: string
    name: string | null
    email: string
    createdAt: Date
    userRoles: Array<{
      role: { id: string; name: string; description: string | null }
    }> | null
    userWards: Array<{ wardId: string }> | null
    hashedPassword: string | null
  } | null

  if (!updated) {
    throw new Error('Failed to retrieve updated user')
  }

  return {
    id: updated.id,
    name: updated.name,
    email: updated.email,
    createdAt: updated.createdAt,
    roles: (updated.userRoles ?? []).map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      description: ur.role.description,
    })),
    wardIds: (updated.userWards ?? []).map((uw) => uw.wardId),
    hasPassword: !!updated.hashedPassword,
  }
}

/**
 * Delete a user (admin). Admin only.
 * Cannot delete self.
 */
export async function deleteUser(userId: string): Promise<void> {
  await requireRole('admin')
  await requireEmailVerifiedIfEnforced()
  await checkAdminRateLimit('delete-user')

  const session = await getCurrentSession()
  const currentUserId = session?.user.id

  if (userId === currentUserId) {
    throw new ForbiddenError('Cannot delete your own account.')
  }

  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
  })

  if (!targetUser) {
    throw new Error('User not found.')
  }

  // The FK cascade removes `userRoles`/`files` rows automatically, but never
  // the underlying S3 objects — delete those first while their bucket keys
  // are still known.
  await deleteAllFilesForUser(userId)

  // Cascade deletes userRoles and files via FK
  await db.delete(users).where(eq(users.id, userId))

  logger.info('Admin deleted user', {
    adminId: currentUserId,
    targetUserId: userId,
  })
}

/**
 * Assign/replace all roles for a user (admin). Admin only.
 */
export async function assignRoles(input: AssignRolesInput): Promise<void> {
  await requireRole('admin')
  await requireEmailVerifiedIfEnforced()
  await checkAdminRateLimit('assign-roles')

  const parsed = assignRolesSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '))
  }

  const { userId, roleIds } = parsed.data

  // Verify user exists
  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
  })
  if (!targetUser) {
    throw new Error('User not found.')
  }

  // Verify all roles exist
  const validRoles = await db.query.roles.findMany({
    where: inArray(roles.id, roleIds),
    columns: { id: true },
  })
  if (validRoles.length !== roleIds.length) {
    throw new Error('One or more roles do not exist.')
  }

  const session = await getCurrentSession()
  const currentUserId = session?.user.id

  // Prevent admin from removing own admin role
  if (userId === currentUserId) {
    const adminRole = await db.query.roles.findFirst({
      where: eq(roles.name, 'admin'),
      columns: { id: true },
    })
    if (adminRole && !roleIds.includes(adminRole.id)) {
      throw new ForbiddenError('Cannot remove your own admin role.')
    }
  }

  // Replace all roles
  await db.delete(userRoles).where(eq(userRoles.userId, userId))
  if (roleIds.length > 0) {
    await db
      .insert(userRoles)
      .values(roleIds.map((roleId) => ({ userId, roleId })))
  }

  logger.info('Admin assigned roles', {
    adminId: currentUserId,
    targetUserId: userId,
    roleIds,
  })
}

/** All wards, for the admin membership UI (spec v0.12.0 FR2). Admin only. */
export async function getAllWards(): Promise<{ id: string; name: string }[]> {
  // Read gated by requireRole('admin'); not rate limited for the same reason
  // as getAllUsersWithRoles — it runs on every /settings render.
  await requireRole('admin')

  const allWards = await db.query.wards.findMany({
    orderBy: (wards, { asc }) => [asc(wards.name)],
  })

  return (allWards ?? []).map((w: { id: string; name: string }) => ({
    id: w.id,
    name: w.name,
  }))
}

/**
 * Assign/replace ward memberships for a user (spec v0.12.0 FR2). Admin only.
 * An empty `wardIds` removes every membership — that user then sees no
 * patient data on any surface (enforced by `requireWardAccess`).
 */
export async function assignWards(input: AssignWardsInput): Promise<void> {
  await requireRole('admin')
  await requireEmailVerifiedIfEnforced()
  await checkAdminRateLimit('assign-wards')

  const parsed = assignWardsSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => i.message).join(', '))
  }

  const { userId, wardIds } = parsed.data

  // Verify user exists
  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true },
  })
  if (!targetUser) {
    throw new Error('User not found.')
  }

  // Verify all wards exist
  if (wardIds.length > 0) {
    const validWards = await db.query.wards.findMany({
      where: inArray(wards.id, wardIds),
      columns: { id: true },
    })
    if (validWards.length !== wardIds.length) {
      throw new Error('One or more wards do not exist.')
    }
  }

  // Replace all memberships
  await db.delete(userWards).where(eq(userWards.userId, userId))
  if (wardIds.length > 0) {
    await db
      .insert(userWards)
      .values(wardIds.map((wardId) => ({ userId, wardId })))
  }

  const session = await getCurrentSession()
  logger.info('Admin assigned ward memberships', {
    adminId: session?.user.id,
    targetUserId: userId,
    wardIds,
  })
}

/**
 * Check if a user can complete registration (has pre-created account, no password).
 * Used by /register page to show appropriate UI.
 */
export async function canCompleteRegistration(email: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, hashedPassword: true },
  })
  return !!user && !user.hashedPassword
}

/**
 * Complete registration for a pre-created user (set password).
 * This is called from the register action when user already exists without password.
 */
export async function completeRegistration(
  email: string,
  password: string,
): Promise<void> {
  await checkAdminRateLimit('complete-registration')

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
    columns: { id: true, hashedPassword: true },
  })

  if (!user) {
    throw new Error('Account not found.')
  }
  if (user.hashedPassword) {
    throw new Error('Account already has a password. Please sign in.')
  }

  // Hash password
  const { hashPassword } = await import('@/lib/auth/password')
  const hashed = await hashPassword(password)

  await db
    .update(users)
    .set({ hashedPassword: hashed })
    .where(eq(users.id, user.id))
  logger.info('User completed registration', { userId: user.id })
}

// Import getCurrentSession here to avoid circular dependency
import { getCurrentSession } from './session'
