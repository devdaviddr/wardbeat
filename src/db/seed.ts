import { config } from 'dotenv'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { hash } from '@node-rs/argon2'
import { users, roles, userRoles } from './schema'

// Idempotent dev seed — safe to run repeatedly. Never run against production.
config({ path: '.env' })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed')

const DEMO = {
  name: 'Demo User',
  email: 'demo@example.com',
  password: 'Password123',
}

/**
 * Full role vocabulary. `admin`/`member`/`viewer` are the inherited platform
 * roles; the clinical set was added by spec v0.12.0 (FR1) and must match the
 * capability matrix in `src/lib/auth/ward-access.ts` and the inserts in
 * migration 0015.
 */
const ROLE_SEED = [
  { name: 'admin', description: 'Full administrative access' },
  { name: 'member', description: 'Standard member access' },
  { name: 'viewer', description: 'Read-only access' },
  {
    name: 'bed_manager',
    description:
      'Bed manager — full ward flow control, including extraction and recommendation runs',
  },
  {
    name: 'charge_nurse',
    description:
      'Charge nurse — acts on barriers and approvals within assigned wards',
  },
  {
    name: 'clinician',
    description:
      'Clinician — acts on barriers and approvals within assigned wards',
  },
  {
    name: 'allied_health',
    description:
      'Allied health — works barriers within assigned wards; no EDD override or approvals',
  },
] as const

async function main() {
  const client = postgres(databaseUrl!, { max: 1 })
  const db = drizzle(client, { schema: { users, roles, userRoles } })

  // Ensure roles exist
  let adminRole: typeof roles.$inferSelect | undefined
  for (const roleDef of ROLE_SEED) {
    let role = await db.query.roles.findFirst({
      where: eq(roles.name, roleDef.name),
    })
    if (!role) {
      const [created] = await db.insert(roles).values(roleDef).returning()
      role = created
      console.log(`✅ Created role: ${roleDef.name}`)
    }
    if (roleDef.name === 'admin') adminRole = role
  }

  // Seed demo user
  let existing = await db.query.users.findFirst({
    where: eq(users.email, DEMO.email),
  })

  if (existing) {
    console.log(`ℹ️  Demo user already exists (${DEMO.email})`)
  } else {
    const hashedPassword = await hash(DEMO.password, {
      memoryCost: 19_456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    })
    const [user] = await db
      .insert(users)
      .values({
        name: DEMO.name,
        email: DEMO.email,
        hashedPassword,
      })
      .returning()
    console.log(`✅ Seeded demo user: ${DEMO.email} / ${DEMO.password}`)
    existing = user
  }

  // Assign admin role to demo user
  if (existing && adminRole) {
    const hasAdminRole = await db.query.userRoles.findFirst({
      where: (ur, { and, eq }) =>
        and(eq(ur.userId, existing.id), eq(ur.roleId, adminRole.id)),
    })

    if (!hasAdminRole) {
      await db.insert(userRoles).values({
        userId: existing.id,
        roleId: adminRole.id,
      })
      console.log(`✅ Assigned admin role to demo user`)
    } else {
      console.log(`ℹ️  Demo user already has admin role`)
    }
  }

  await client.end()
  process.exit(0)
}

main().catch((err) => {
  console.error('❌ Seed failed', err)
  process.exit(1)
})
