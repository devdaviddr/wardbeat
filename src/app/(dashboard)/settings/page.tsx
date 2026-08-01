import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentSession } from '@/lib/auth/session'
import {
  getAllUsersWithRoles,
  getAllRoles,
  getAllWards,
  type UserWithRoles,
} from '@/lib/auth/admin-actions'
import { getLinkedAccounts } from '@/lib/auth/account-actions'
import { getVapidPublicKey } from '@/lib/push'
import { listMyFiles } from '@/lib/storage/actions'
import { getAiConfiguration, type AiConfiguration } from '@/lib/ai/config'
import { env } from '@/lib/env'
import { SettingsClient } from './settings-client'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const session = await getCurrentSession()
  if (!session?.user) {
    redirect('/login')
  }

  const isAdmin = (session.user.roles ?? []).includes('admin')

  // Fetch data in parallel. The AI configuration is admin-only and read over the
  // internal service token (never from the browser).
  const [users, roles, wards, files, linkedAccounts, aiConfig] =
    await Promise.all([
      isAdmin ? getAllUsersWithRoles() : Promise.resolve([] as UserWithRoles[]),
      isAdmin
        ? getAllRoles()
        : Promise.resolve(
            [] as Array<{
              id: string
              name: string
              description: string | null
            }>,
          ),
      isAdmin
        ? getAllWards()
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      listMyFiles(),
      getLinkedAccounts(),
      isAdmin
        ? getAiConfiguration()
        : Promise.resolve(null as AiConfiguration | null),
    ])

  // Ensure user properties are never undefined (they're required by auth)
  const sessionWithId = {
    ...session,
    user: {
      ...session.user,
      id: session.user.id ?? '',
      name: session.user.name ?? null,
      email: session.user.email ?? '',
      image: session.user.image ?? null,
      roles: session.user.roles ?? [],
    },
  }

  return (
    <SettingsClient
      session={sessionWithId}
      users={users ?? []}
      roles={roles ?? []}
      wards={wards ?? []}
      files={files ?? []}
      linkedAccounts={linkedAccounts}
      pushPublicKey={getVapidPublicKey()}
      isAdmin={isAdmin}
      aiConfig={aiConfig}
      buildVersion={env.APP_VERSION}
      buildSha={env.APP_GIT_SHA}
    />
  )
}
