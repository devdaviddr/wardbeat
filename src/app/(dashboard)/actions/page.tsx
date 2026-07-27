import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { ActionQueue } from '@/components/actions/action-queue'
import { getActionQueue } from '@/lib/actions/queries'
import { getCurrentSession } from '@/lib/auth/session'
import { env } from '@/lib/env'

export const metadata: Metadata = { title: 'Action queue' }
export const dynamic = 'force-dynamic'

export default async function ActionsPage() {
  if (!env.FEATURE_ACTIONS) notFound()

  const session = await getCurrentSession()
  if (!session?.user) redirect('/login')

  const queue = await getActionQueue()
  return <ActionQueue queue={queue} />
}
