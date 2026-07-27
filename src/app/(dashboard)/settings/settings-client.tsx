'use client'

import { useState } from 'react'

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
import { cn } from '@/lib/utils'

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

interface Tab {
  id: string
  label: string
  description?: string
  content: React.ReactNode
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

  // Tabs are assembled conditionally so non-admins never see admin-only areas.
  const tabs: Tab[] = [
    {
      id: 'account',
      label: 'Account',
      description: 'Your profile and how you sign in.',
      content: (
        <>
          <CurrentUserCard user={session.user} allRoles={formattedRoles} />
          <ConnectedAccounts state={linkedAccounts} />
        </>
      ),
    },
    {
      id: 'files',
      label: 'Files & notifications',
      description: 'Your uploads and push notifications on this device.',
      content: (
        <>
          <FilesPanel initialFiles={files} />
          {pushPublicKey && <NotificationsPanel publicKey={pushPublicKey} />}
        </>
      ),
    },
    {
      id: 'system',
      label: 'System',
      description: 'How this instance is configured and what it is running.',
      content: (
        <>
          {/* Server-authoritative gate — the config fetch is admin-only too. */}
          {isAdmin && aiConfig && <AiConfigCard config={aiConfig} />}
          <BuildInfoCard version={buildVersion} sha={buildSha} />
        </>
      ),
    },
  ]

  if (isAdmin) {
    tabs.push({
      id: 'administration',
      label: 'Administration',
      description: 'Manage users and their roles.',
      content: (
        <AdminPanel
          initialUsers={users}
          allRoles={formattedRoles}
          currentUserId={session.user.id}
        />
      ),
    })
  }

  // `tabs` always has at least the Account tab, so index 0 is safe.
  const [activeId, setActiveId] = useState(tabs[0]!.id)
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]!

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex flex-wrap gap-1 overflow-x-auto border-b"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === active.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveId(tab.id)}
              className={cn(
                '-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <div role="tabpanel" className="space-y-6">
        {active.description && (
          <p className="text-muted-foreground text-sm">{active.description}</p>
        )}
        {active.content}
      </div>
    </div>
  )
}
