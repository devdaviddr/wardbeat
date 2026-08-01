import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { CopilotChat } from '@/components/copilot/copilot-chat'
import { getCurrentSession } from '@/lib/auth/session'
import { requireWardAccess } from '@/lib/auth/ward-access'
import { env } from '@/lib/env'

export const metadata: Metadata = { title: 'Flow copilot' }
export const dynamic = 'force-dynamic'

export default async function CopilotPage() {
  if (!env.FEATURE_COPILOT) notFound()

  const session = await getCurrentSession()
  if (!session?.user) redirect('/login')

  // Copilot answers are ward data. `askCopilotAction` re-checks server-side;
  // this keeps a user with no ward assignment from a dead-end chat UI.
  const access = await requireWardAccess('ask_copilot', { any: true })
  if (!access.ok) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Flow copilot</h1>
        <p className="text-muted-foreground text-sm">
          You have not been assigned to a ward yet. Ask an administrator to
          assign you a clinical role and ward in Settings.
        </p>
      </div>
    )
  }

  return <CopilotChat />
}
