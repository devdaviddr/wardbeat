import type { Metadata } from 'next'

import { GuideEmbed } from '@/components/about/guide-embed'

export const metadata: Metadata = { title: 'Workflow · About' }

export default function AboutWorkflowPage() {
  return <GuideEmbed file="about-workflow.html" />
}
