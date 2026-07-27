import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { CopilotChat } from '@/components/copilot/copilot-chat'
import { getCurrentSession } from '@/lib/auth/session'
import { env } from '@/lib/env'

export const metadata: Metadata = { title: 'Flow copilot' }
export const dynamic = 'force-dynamic'

export default async function CopilotPage() {
  if (!env.FEATURE_COPILOT) notFound()

  const session = await getCurrentSession()
  if (!session?.user) redirect('/login')

  return <CopilotChat />
}
