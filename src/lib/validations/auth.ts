import { z } from 'zod'

/**
 * Shared auth input schemas. Used by client forms (react-hook-form), server
 * actions, and the credentials provider so validation rules live in one place.
 */

const email = z
  .string()
  .min(1, 'Email is required')
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address').max(255))

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  // Argon2 has no bcrypt-style 72-byte limit; this cap only bounds hashing cost
  // (a DoS guard against absurdly long inputs).
  .max(128, 'Password must be at most 128 characters')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
})

export const registerSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(255),
    email,
    password: password
      .regex(/[a-z]/, 'Include at least one lowercase letter')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[0-9]/, 'Include at least one number'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

/** Strong password with the same rules as registration. */
const strongPassword = password
  .regex(/[a-z]/, 'Include at least one lowercase letter')
  .regex(/[A-Z]/, 'Include at least one uppercase letter')
  .regex(/[0-9]/, 'Include at least one number')

/** Request a password-reset link. */
export const forgotPasswordSchema = z.object({ email })

/** Complete a password reset with the emailed token. */
export const resetPasswordSchema = z
  .object({
    email,
    token: z.string().min(1, 'Reset token is required'),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })

/** Admin: create a new user (no password — user sets it on first login) */
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255),
  email,
  roleIds: z.array(z.string().uuid()).min(1, 'At least one role required'),
})

/** Admin: update user name/email/roles */
export const updateUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255).optional(),
  email: email.optional(),
  roleIds: z.array(z.string().uuid()).optional(),
})

/** Admin: assign/replace roles for a user */
export const assignRolesSchema = z.object({
  userId: z.string().uuid(),
  roleIds: z.array(z.string().uuid()).min(1, 'At least one role required'),
})

/**
 * Admin: assign/replace ward memberships for a user (spec v0.12.0 FR2).
 * An empty array is valid — it removes the user from every ward, which is the
 * "sees no patient data at all" state.
 */
export const assignWardsSchema = z.object({
  userId: z.string().uuid(),
  wardIds: z.array(z.string().uuid()),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
export type CreateUserInput = z.infer<typeof createUserSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type AssignRolesInput = z.infer<typeof assignRolesSchema>
export type AssignWardsInput = z.infer<typeof assignWardsSchema>
