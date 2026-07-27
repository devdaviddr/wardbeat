'use client'

import { CurrentUserCard } from '@/components/auth/current-user-card'
import { AdminPanel } from '@/components/auth/admin-panel'
import { ConnectedAccounts } from '@/components/auth/connected-accounts'
import { FilesPanel } from '@/components/files/files-panel'
import { NotificationsPanel } from '@/components/push/notifications-panel'
import { AiConfigCard } from '@/components/settings/ai-config-card'
import { BuildInfoCard } from '@/components/settings/build-info-card'
import type { AiConfiguration } from '@/lib/ai/config'
import type { LinkedAccountsState } from '@/lib/auth/account-actions'
import type { FileSummary } from '@/lib/storage/actions'

interface SettingsClientProps {
  session: {
    user: {
      id: string
      name: string | null
      email: string
      image: string | null | undefined
      roles: string[]
    }
  }
  users: Array<{
    id: string
    name: string | null
    email: string
    createdAt: Date
    roles: Array<{ id: string; name: string; description: string | null }>
    hasPassword: boolean
  }>
  roles: Array<{ id: string; name: string; description: string | null }>
  files: FileSummary[]
  linkedAccounts: LinkedAccountsState
  pushPublicKey: string | null
  isAdmin: boolean
  aiConfig: AiConfiguration | null
  buildVersion?: string
  buildSha?: string
}

/** A labelled group of setting cards. */
function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </div>
      {children}
    </section>
  )
}

export function SettingsClient({
  session,
  users,
  roles,
  files,
  linkedAccounts,
  pushPublicKey,
  isAdmin,
  aiConfig,
  buildVersion,
  buildSha,
}: SettingsClientProps) {
  const formattedRoles = roles.map((r) => ({ id: r.id, name: r.name }))

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Section title="Account" description="Your profile and how you sign in.">
        <CurrentUserCard user={session.user} allRoles={formattedRoles} />
        <ConnectedAccounts state={linkedAccounts} />
      </Section>

      <Section
        title="Files & notifications"
        description="Your uploads and push notifications on this device."
      >
        <FilesPanel initialFiles={files} />
        {pushPublicKey && <NotificationsPanel publicKey={pushPublicKey} />}
      </Section>

      {/* Server-authoritative gate — the admin server actions also enforce it. */}
      {isAdmin ? (
        <Section
          title="System"
          description="How this instance is configured and what it is running."
        >
          {aiConfig && <AiConfigCard config={aiConfig} />}
          <BuildInfoCard version={buildVersion} sha={buildSha} />
        </Section>
      ) : (
        <Section title="System">
          <BuildInfoCard version={buildVersion} sha={buildSha} />
        </Section>
      )}

      {isAdmin && (
        <Section
          title="Administration"
          description="Manage users and their roles."
        >
          <AdminPanel
            initialUsers={users}
            allRoles={formattedRoles}
            currentUserId={session.user.id}
          />
        </Section>
      )}
    </div>
  )
}
